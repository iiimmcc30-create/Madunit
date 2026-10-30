import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { dash, escapeHtml, page } from "../web/html";
import { parseCjProductRef } from "./cj-client";
import { ShopError, type ShopService } from "./service";
import { cartPageHtml, orderPageHtml, productListHtml, productPageHtml, shopPage } from "./storefront";

export function orderKey(number: string, secret: string): string {
  return createHmac("sha256", `shop:${secret}`).update(number).digest("base64url").slice(0, 22);
}

function keyOk(number: string, key: string, secret: string): boolean {
  const expected = orderKey(number, secret);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(key));
  } catch {
    return false;
  }
}

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > limit) throw new ShopError("الحجم كبير.");
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  new URLSearchParams((await readRaw(req, 100_000)).toString("utf8")).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/** Public storefront: /shop, /shop/p/:slug, /shop/cart, /shop/order/:n, /api/shop/*. Returns true if handled. */
export async function handleShopPublic(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  shop: ShopService,
  db: PrismaClient,
  secret: string,
): Promise<boolean> {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (!p.startsWith("/shop") && !p.startsWith("/api/shop")) return false;
  const read = req.method === "GET" || req.method === "HEAD";
  try {
    if (read && p === "/shop") {
      html(res, 200, productListHtml(await shop.listPublished()));
      return true;
    }
    const prod = p.match(/^\/shop\/p\/([a-z0-9-]+)$/);
    if (read && prod) {
      const product = await shop.findPublishedBySlug(prod[1]);
      if (!product) html(res, 404, shopPage("غير موجود", `<p>المنتج غير متوفر. <a href="/shop">رجوع للمتجر</a></p>`));
      else html(res, 200, productPageHtml(product));
      return true;
    }
    if (read && p === "/shop/cart") {
      html(res, 200, cartPageHtml());
      return true;
    }
    const ord = p.match(/^\/shop\/order\/([A-Z0-9]+)$/);
    if (read && ord) {
      const key = url.searchParams.get("k") ?? "";
      const order = keyOk(ord[1], key, secret)
        ? await db.order.findUnique({ where: { number: ord[1] }, include: { items: true } })
        : null;
      if (!order) html(res, 404, shopPage("غير موجود", `<p>الطلب غير موجود.</p>`));
      else html(res, 200, orderPageHtml(order, key));
      return true;
    }
    if (req.method === "POST" && p === "/api/shop/checkout") {
      const body = JSON.parse((await readRaw(req, 50_000)).toString("utf8") || "{}");
      const items = Array.isArray(body.items)
        ? body.items.map((i: { variantId?: unknown; quantity?: unknown }) => ({ variantId: String(i.variantId ?? ""), quantity: Number(i.quantity) }))
        : [];
      const order = await shop.checkout({
        customerName: String(body.customerName ?? ""),
        phone: String(body.phone ?? ""),
        city: String(body.city ?? ""),
        district: String(body.district ?? ""),
        street: String(body.street ?? ""),
        postalCode: String(body.postalCode ?? ""),
        notes: String(body.notes ?? ""),
        items,
      });
      json(res, 201, { number: order.number, key: orderKey(order.number, secret), totalSar: order.totalSar.toNumber() });
      return true;
    }
    const rc = p.match(/^\/api\/shop\/orders\/([A-Z0-9]+)\/receipt$/);
    if (req.method === "POST" && rc) {
      if (!keyOk(rc[1], url.searchParams.get("k") ?? "", secret)) {
        json(res, 403, { error: "رابط غير صالح" });
        return true;
      }
      const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim();
      const data = await readRaw(req, 5 * 1024 * 1024 + 1);
      await shop.attachReceipt(rc[1], mime, data);
      json(res, 200, { ok: true });
      return true;
    }
    if (p.startsWith("/api/shop")) {
      json(res, 404, { error: "not found" });
      return true;
    }
    html(res, 404, shopPage("غير موجود", `<p>الصفحة غير موجودة. <a href="/shop">المتجر</a></p>`));
    return true;
  } catch (error) {
    const message = error instanceof ShopError ? error.userMessage : error instanceof SyntaxError ? "طلب غير صالح." : "صار خطأ، حاول مرة ثانية.";
    if (p.startsWith("/api/")) json(res, 400, { error: message });
    else html(res, 500, shopPage("خطأ", `<p>${escapeHtml(message)}</p>`));
    return true;
  }
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "بانتظار التحويل",
  RECEIPT_UPLOADED: "إيصال مرفوع",
  PAID: "مدفوع",
  CJ_CREATED: "عند CJ",
  CJ_FAILED: "فشل CJ",
  SHIPPED: "مشحون",
  DELIVERED: "موصّل",
  CANCELLED: "ملغي",
};

function redirect(res: ServerResponse, to: string) {
  res.writeHead(303, { location: to });
  res.end();
}

/** Admin pages under /dashboard/shop/*. `inner` is the path after /dashboard. */
export async function handleShopAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  inner: string,
  user: string,
  shop: ShopService,
  db: PrismaClient,
): Promise<boolean> {
  if (!inner.startsWith("/shop")) return false;
  try {
    if (req.method === "POST") {
      const form = await readForm(req);
      if (inner === "/shop/import") {
        const pid = parseCjProductRef(form.ref ?? "");
        if (!pid) throw new ShopError("الصق رقم منتج CJ أو رابطه.");
        const product = await shop.importProduct(pid, Number(form.markup || "0") || undefined);
        redirect(res, dash(`/shop/products/${product.id}`));
        return true;
      }
      const pa = inner.match(/^\/shop\/products\/([^/]+)\/(save|publish|unpublish|stock)$/);
      if (pa) {
        if (pa[2] === "save") await shop.setMarkup(pa[1], Number(form.markup), form.titleAr, form.descriptionAr);
        if (pa[2] === "publish") await shop.setPublished(pa[1], true);
        if (pa[2] === "unpublish") await shop.setPublished(pa[1], false);
        if (pa[2] === "stock") await shop.refreshStock(pa[1]);
        redirect(res, dash(`/shop/products/${pa[1]}`));
        return true;
      }
      const oa = inner.match(/^\/shop\/orders\/([^/]+)\/(paid|retry|cancel|sync)$/);
      if (oa) {
        if (oa[2] === "paid") await shop.markPaid(oa[1], user, form.paymentRef);
        if (oa[2] === "retry") await shop.pushToCj(oa[1]);
        if (oa[2] === "cancel") await shop.cancel(oa[1]);
        if (oa[2] === "sync") await shop.syncTracking();
        redirect(res, dash(`/shop/orders/${oa[1]}`));
        return true;
      }
      return false;
    }

    if (inner === "/shop" || inner === "/shop/products") {
      const products = await db.product.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { variants: true } } } });
      const rows = products
        .map(
          (p) => `<tr><td><a href="${dash(`/shop/products/${p.id}`)}">${escapeHtml(p.titleAr || p.titleEn)}</a><br><code>${escapeHtml(p.cjPid)}</code></td>
<td>${p.costUsd.toNumber()}$</td><td>${p.markupPercent.toNumber()}%</td><td>${p.priceSar.toNumber()} ر.س</td><td>${p._count.variants}</td><td>${escapeHtml(p.status)}</td></tr>`,
        )
        .join("");
      const body = `<h1>منتجات المتجر</h1>
<p><a href="${dash("/shop/orders")}">الطلبات ←</a> · <a href="/shop" target="_blank">فتح المتجر</a> ${shop.cjEnabled ? "" : `· <b style="color:#f87171">CJ_API_KEY غير مضبوط</b>`}</p>
<div class="card"><form method="post" action="${dash("/shop/import")}">
<p>استيراد منتج من CJ (رقم المنتج PID أو الرابط):</p>
<input name="ref" required placeholder="https://cjdropshipping.com/product/...-p-XXXX.html" style="width:100%">
<p>نسبة الربح %: <input name="markup" type="number" min="0" max="1000" value="" placeholder="الافتراضي"> <button>استيراد</button></p>
</form></div>
<table><tr><th>المنتج</th><th>التكلفة</th><th>الربح</th><th>السعر</th><th>الخيارات</th><th>الحالة</th></tr>${rows || `<tr><td colspan="6">ما فيه منتجات.</td></tr>`}</table>`;
      html(res, 200, page("منتجات المتجر", body));
      return true;
    }

    const pd = inner.match(/^\/shop\/products\/([^/]+)$/);
    if (pd) {
      const p = await db.product.findUnique({ where: { id: pd[1] }, include: { variants: { orderBy: { priceSar: "asc" } } } });
      if (!p) return false;
      const body = `<h1>${escapeHtml(p.titleAr || p.titleEn)}</h1>
<p><a href="${dash("/shop")}">← المنتجات</a> · CJ: <code>${escapeHtml(p.cjPid)}</code> · الحالة: <b>${escapeHtml(p.status)}</b>
${p.status === "PUBLISHED" ? ` · <a href="/shop/p/${escapeHtml(p.slug)}" target="_blank">عرض</a>` : ""}</p>
<div class="row-actions">
<form method="post" action="${dash(`/shop/products/${p.id}/${p.status === "PUBLISHED" ? "unpublish" : "publish"}`)}"><button>${p.status === "PUBLISHED" ? "إلغاء النشر" : "نشر"}</button></form>
<form method="post" action="${dash(`/shop/products/${p.id}/stock`)}"><button>تحديث المخزون من CJ</button></form>
</div>
<div class="card"><form method="post" action="${dash(`/shop/products/${p.id}/save`)}">
<p>العنوان بالعربي<br><input name="titleAr" value="${escapeHtml(p.titleAr)}" style="width:100%" placeholder="${escapeHtml(p.titleEn)}"></p>
<p>الوصف بالعربي<br><textarea name="descriptionAr" rows="5" style="width:100%">${escapeHtml(p.descriptionAr)}</textarea></p>
<p>نسبة الربح % (على التكلفة×سعر الصرف): <input name="markup" type="number" step="1" min="0" max="1000" value="${p.markupPercent.toNumber()}"> <button>حفظ وإعادة التسعير</button></p>
</form></div>
<table><tr><th>الخيار</th><th>SKU</th><th>VID</th><th>التكلفة $</th><th>السعر ر.س</th><th>المخزون</th></tr>
${p.variants.map((v) => `<tr><td>${escapeHtml(v.name)}</td><td>${escapeHtml(v.sku)}</td><td><code>${escapeHtml(v.cjVid)}</code></td><td>${v.costUsd.toNumber()}</td><td>${v.priceSar.toNumber()}</td><td>${v.stock ?? "—"}</td></tr>`).join("")}</table>
<details><summary>الوصف الإنجليزي من CJ</summary><p>${escapeHtml(p.descriptionEn)}</p></details>`;
      html(res, 200, page("منتج", body));
      return true;
    }

    if (inner === "/shop/orders") {
      const orders = await db.order.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
      const body = `<h1>طلبات المتجر</h1><p><a href="${dash("/shop")}">← المنتجات</a></p>
<table><tr><th>الرقم</th><th>العميل</th><th>المدينة</th><th>المجموع</th><th>الحالة</th><th>CJ</th><th>التتبع</th><th>التاريخ</th></tr>
${orders.map((o) => `<tr><td><a href="${dash(`/shop/orders/${o.id}`)}">${escapeHtml(o.number)}</a></td><td>${escapeHtml(o.customerName)}</td><td>${escapeHtml(o.city)}</td><td>${o.totalSar.toNumber()}</td><td>${escapeHtml(STATUS_LABEL[o.status] ?? o.status)}</td><td>${escapeHtml(o.cjOrderId ?? "—")}</td><td>${escapeHtml(o.trackingNumber ?? "—")}</td><td>${o.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td></tr>`).join("") || `<tr><td colspan="8">ما فيه طلبات.</td></tr>`}</table>`;
      html(res, 200, page("الطلبات", body));
      return true;
    }

    const rc = inner.match(/^\/shop\/orders\/([^/]+)\/receipt$/);
    if (rc) {
      const o = await db.order.findUnique({ where: { id: rc[1] }, select: { receiptData: true, receiptMime: true } });
      if (!o?.receiptData) return false;
      res.writeHead(200, { "content-type": o.receiptMime ?? "application/octet-stream", "cache-control": "private, no-store" });
      res.end(Buffer.from(o.receiptData));
      return true;
    }

    const od = inner.match(/^\/shop\/orders\/([^/]+)$/);
    if (od) {
      const o = await db.order.findUnique({ where: { id: od[1] }, include: { items: { include: { variant: true } } } });
      if (!o) return false;
      const act = (a: string, label: string, confirmMsg?: string) =>
        `<form method="post" action="${dash(`/shop/orders/${o.id}/${a}`)}"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ""}>${a === "paid" ? `<input name="paymentRef" placeholder="مرجع التحويل (اختياري)">` : ""}<button>${label}</button></form>`;
      const body = `<h1>الطلب ${escapeHtml(o.number)}</h1><p><a href="${dash("/shop/orders")}">← الطلبات</a></p>
<div class="card"><p>الحالة: <b>${escapeHtml(STATUS_LABEL[o.status] ?? o.status)}</b> · المجموع: <b>${o.totalSar.toNumber()} ر.س</b></p>
<p>${escapeHtml(o.customerName)} · <span dir="ltr">${escapeHtml(o.phone)}</span><br>${escapeHtml(o.city)} — ${escapeHtml(o.district)} — ${escapeHtml(o.street)} ${escapeHtml(o.postalCode)}</p>
${o.notes ? `<p>ملاحظات: ${escapeHtml(o.notes)}</p>` : ""}
<p>CJ: ${escapeHtml(o.cjOrderId ?? "—")} (${escapeHtml(o.cjOrderStatus ?? "")}) · تتبع: ${escapeHtml(o.trackingNumber ?? "—")} ${escapeHtml(o.trackingStatus ?? "")}</p>
<p>الإيصال: ${o.receiptUploadedAt ? `<a href="${dash(`/shop/orders/${o.id}/receipt`)}" target="_blank">عرض الإيصال</a>` : "لم يُرفع"}</p></div>
<table><tr><th>المنتج</th><th>VID</th><th>الكمية</th><th>السعر</th></tr>${o.items.map((i) => `<tr><td>${escapeHtml(i.title)}</td><td><code>${escapeHtml(i.variant.cjVid)}</code></td><td>${i.quantity}</td><td>${i.unitPriceSar.toNumber()}</td></tr>`).join("")}</table>
<div class="row-actions">
${!o.paidAt && o.status !== "CANCELLED" ? act("paid", "تأكيد الدفع وإرسال لـ CJ", "متأكد إن التحويل وصل؟") : ""}
${o.status === "CJ_FAILED" ? act("retry", "إعادة المحاولة مع CJ") : ""}
${o.cjOrderId ? act("sync", "تحديث التتبع") : ""}
${!o.cjOrderId && o.status !== "CANCELLED" ? act("cancel", "إلغاء الطلب", "إلغاء الطلب؟") : ""}
</div>`;
      html(res, 200, page("طلب", body));
      return true;
    }
    return false;
  } catch (error) {
    const message = error instanceof ShopError ? error.userMessage : String(error instanceof Error ? error.message : error);
    html(res, 400, page("خطأ", `<p>${escapeHtml(message)}</p><p><a href="${dash("/shop")}">رجوع</a></p>`));
    return true;
  }
}
