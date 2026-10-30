import { Prisma, type PrismaClient, type ShopOrderStatus } from "@prisma/client";
import { CjClient, CjError, type CjProductDetail } from "./cj-client";
import { isSaudiPhone, normalizeSaudiPhone, orderNumber, parseCjPrice, priceFromCost, slugify } from "./pricing";

export interface ShopConfig {
  cjApiKey: string;
  usdToSar: number;
  defaultMarkupPercent: number;
  defaultLogistic: string;
  /** 2 = pay from CJ balance automatically; 3 = create only (pay in CJ dashboard). */
  cjPayType: 2 | 3;
  tokenCacheFile?: string;
}

export type ShopNotifier = (text: string) => Promise<void>;

export interface CheckoutInput {
  customerName: string;
  phone: string;
  city: string;
  district?: string;
  street: string;
  postalCode?: string;
  notes?: string;
  items: { variantId: string; quantity: number }[];
}

/** Payment providers plug in here. Bank transfer is the only one for now. */
export interface PaymentProvider {
  id: string;
  label: string;
  instructionsHtml(order: { number: string; totalSar: number }): string;
}

export const bankTransfer: PaymentProvider = {
  id: "bank_transfer",
  label: "تحويل بنكي",
  instructionsHtml: (order) => `<p>حوّل <b>${order.totalSar} ريال</b> إلى:</p>
<ul>
<li>البنك: STC Bank</li>
<li>الآيبان: <code dir="ltr">SA1178000000001341615948</code></li>
<li>اسم المستفيد: MAD UNIT ESPORTS ESTABLISHMENT FOR TRADING</li>
<li>اكتب رقم الطلب <b dir="ltr">${order.number}</b> في ملاحظة التحويل</li>
</ul>
<p>بعدها ارفع صورة الإيصال تحت، ونأكد الدفع ونشحن طلبك.</p>`,
};

export class ShopError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

export class ShopService {
  private cjClient: CjClient | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly config: ShopConfig,
    private readonly notify: ShopNotifier = async () => {},
  ) {}

  get cjEnabled(): boolean {
    return Boolean(this.config.cjApiKey);
  }

  cj(): CjClient {
    if (!this.cjClient) {
      this.cjClient = new CjClient({ apiKey: this.config.cjApiKey, tokenCacheFile: this.config.tokenCacheFile });
    }
    return this.cjClient;
  }

  private async log(kind: string, ref: string | null, ok: boolean, message: string, payload?: unknown) {
    await this.db.cjSync.create({
      data: {
        kind,
        ref,
        ok,
        message: message.slice(0, 2000),
        payload: payload === undefined ? undefined : (JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue),
      },
    });
  }

  // ───── Catalog ─────

  async importProduct(pid: string, markupPercent = this.config.defaultMarkupPercent) {
    let detail: CjProductDetail;
    try {
      detail = await this.cj().productDetail(pid);
    } catch (error) {
      await this.log("import", pid, false, String(error));
      throw new ShopError(error instanceof CjError ? `CJ: ${error.message}` : "تعذر جلب المنتج من CJ.");
    }
    const shippingUsd = await this.estimateShippingUsd(detail.variants?.[0]?.vid);
    const product = await this.upsertFromDetail(detail, markupPercent, { shippingUsd });
    await this.log("import", pid, true, `imported ${product.variants.length} variants`);
    return product;
  }

  async upsertFromDetail(detail: CjProductDetail, markupPercent: number, extra?: { titleAr?: string; shippingUsd?: number }) {
    const images = normalizeImages(detail);
    const variants = detail.variants ?? [];
    const costs = variants.map((v) => parseCjPrice(v.variantSellPrice)).filter((n) => n > 0);
    const costUsd = costs.length ? Math.min(...costs) : parseCjPrice(detail.sellPrice);
    const shippingUsd = extra?.shippingUsd ?? 0;
    const rate = this.config.usdToSar;
    const data = {
      titleEn: detail.productNameEn,
      descriptionEn: stripHtml(detail.description ?? "").slice(0, 5000),
      images,
      costUsd: new Prisma.Decimal(costUsd),
      markupPercent: new Prisma.Decimal(markupPercent),
      priceSar: new Prisma.Decimal(priceFromCost(costUsd, markupPercent, rate, shippingUsd)),
      shippingSar: new Prisma.Decimal(Math.round(shippingUsd * rate * 100) / 100),
      raw: JSON.parse(JSON.stringify(detail)) as Prisma.InputJsonValue,
    };
    const product = await this.db.product.upsert({
      where: { cjPid: detail.pid },
      create: {
        cjPid: detail.pid,
        slug: slugify(detail.productNameEn, detail.pid),
        titleAr: extra?.titleAr ?? "",
        status: "DRAFT",
        ...data,
      },
      update: { ...data, ...(extra?.titleAr ? { titleAr: extra.titleAr } : {}) },
    });
    for (const v of variants) {
      const vc = parseCjPrice(v.variantSellPrice) || costUsd;
      await this.db.productVariant.upsert({
        where: { cjVid: v.vid },
        create: {
          productId: product.id,
          cjVid: v.vid,
          sku: v.variantSku ?? "",
          name: v.variantKey || v.variantNameEn || "",
          image: v.variantImage ?? null,
          costUsd: new Prisma.Decimal(vc),
          priceSar: new Prisma.Decimal(priceFromCost(vc, markupPercent, rate, shippingUsd)),
        },
        update: {
          sku: v.variantSku ?? "",
          name: v.variantKey || v.variantNameEn || "",
          image: v.variantImage ?? null,
          costUsd: new Prisma.Decimal(vc),
          priceSar: new Prisma.Decimal(priceFromCost(vc, markupPercent, rate, shippingUsd)),
        },
      });
    }
    return this.db.product.findUniqueOrThrow({ where: { id: product.id }, include: { variants: true } });
  }

  /** Cheapest CJ freight to Saudi Arabia for one unit, preferring the configured logistic. */
  async estimateShippingUsd(vid: string | undefined): Promise<number> {
    if (!vid) return 0;
    try {
      const options = await this.cj().freight({ endCountryCode: "SA", products: [{ vid, quantity: 1 }] });
      const preferred = options.find((o) => o.logisticName === this.config.defaultLogistic);
      const pick = preferred ?? [...options].sort((x, y) => x.logisticPrice - y.logisticPrice)[0];
      return pick ? Number(pick.logisticPrice) || 0 : 0;
    } catch (error) {
      await this.log("freight", vid, false, String(error));
      return 0;
    }
  }

  async setMarkup(productId: string, markupPercent: number, titleAr?: string, descriptionAr?: string) {
    if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) {
      throw new ShopError("نسبة الربح غير صحيحة.");
    }
    const product = await this.db.product.findUniqueOrThrow({ where: { id: productId }, include: { variants: true } });
    const rate = this.config.usdToSar;
    const shipUsd = product.shippingSar.toNumber() / rate;
    await this.db.product.update({
      where: { id: productId },
      data: {
        markupPercent: new Prisma.Decimal(markupPercent),
        priceSar: new Prisma.Decimal(priceFromCost(product.costUsd.toNumber(), markupPercent, rate, shipUsd)),
        ...(titleAr !== undefined ? { titleAr } : {}),
        ...(descriptionAr !== undefined ? { descriptionAr } : {}),
      },
    });
    for (const v of product.variants) {
      await this.db.productVariant.update({
        where: { id: v.id },
        data: { priceSar: new Prisma.Decimal(priceFromCost(v.costUsd.toNumber(), markupPercent, rate, shipUsd)) },
      });
    }
  }

  async setPublished(productId: string, published: boolean) {
    await this.db.product.update({
      where: { id: productId },
      data: { status: published ? "PUBLISHED" : "UNPUBLISHED" },
    });
  }

  async refreshStock(productId: string) {
    const variants = await this.db.productVariant.findMany({ where: { productId } });
    for (const v of variants) {
      try {
        const stock = await this.cj().variantStock(v.cjVid);
        await this.db.productVariant.update({ where: { id: v.id }, data: { stock } });
      } catch (error) {
        await this.log("stock", v.cjVid, false, String(error));
      }
    }
  }

  listPublished() {
    return this.db.product.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      include: { variants: { where: { active: true }, orderBy: { priceSar: "asc" } } },
    });
  }

  findPublishedBySlug(slug: string) {
    return this.db.product.findFirst({
      where: { slug, status: "PUBLISHED" },
      include: { variants: { where: { active: true }, orderBy: { priceSar: "asc" } } },
    });
  }

  // ───── Orders ─────

  async checkout(input: CheckoutInput) {
    const name = input.customerName?.trim();
    const city = input.city?.trim();
    const street = input.street?.trim();
    if (!name || name.length < 3) throw new ShopError("اكتب الاسم كامل.");
    if (!isSaudiPhone(input.phone ?? "")) throw new ShopError("رقم الجوال لازم يكون سعودي (05xxxxxxxx).");
    if (!city || !street) throw new ShopError("اكتب المدينة والعنوان.");
    const items = (input.items ?? []).filter((i) => Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 20);
    if (!items.length || items.length > 30) throw new ShopError("السلة فاضية.");

    const variants = await this.db.productVariant.findMany({
      where: { id: { in: items.map((i) => i.variantId) }, active: true, product: { status: "PUBLISHED" } },
      include: { product: true },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    let subtotal = 0;
    const shipping = 0; // shipping estimate is built into each product price (Product.shippingSar)
    const lines = items.map((i) => {
      const v = byId.get(i.variantId);
      if (!v) throw new ShopError("فيه منتج في السلة ما عاد متوفر.");
      subtotal += v.priceSar.toNumber() * i.quantity;
      return {
        variantId: v.id,
        quantity: i.quantity,
        unitPriceSar: v.priceSar,
        title: `${v.product.titleAr || v.product.titleEn}${v.name ? ` — ${v.name}` : ""}`,
      };
    });
    const order = await this.db.order.create({
      data: {
        number: orderNumber(),
        customerName: name,
        phone: normalizeSaudiPhone(input.phone),
        city,
        district: input.district?.trim() ?? "",
        street,
        postalCode: input.postalCode?.trim() ?? "",
        notes: input.notes?.trim().slice(0, 500) ?? "",
        subtotalSar: new Prisma.Decimal(subtotal),
        shippingSar: new Prisma.Decimal(shipping),
        totalSar: new Prisma.Decimal(subtotal + shipping),
        manualFulfilment: lines.some((l) => byId.get(l.variantId)?.product.supplier === "manual"),
        items: { create: lines },
      },
    });
    await this.notify(`🛒 طلب جديد ${order.number}\n${name} — ${city}\nالمجموع: ${order.totalSar.toNumber()} ريال\nبانتظار التحويل.`);
    if (order.manualFulfilment) await this.notifyManual(order.id, "طلب جديد — بانتظار التحويل");
    return order;
  }

  async attachReceipt(number: string, mime: string, data: Buffer) {
    if (!/^image\/(png|jpe?g|webp)$|^application\/pdf$/.test(mime)) throw new ShopError("الإيصال لازم صورة أو PDF.");
    if (data.length > 5 * 1024 * 1024) throw new ShopError("حجم الإيصال أكبر من 5MB.");
    const order = await this.db.order.findUnique({ where: { number } });
    if (!order) throw new ShopError("الطلب غير موجود.");
    if (order.status !== "PENDING_PAYMENT" && order.status !== "RECEIPT_UPLOADED") throw new ShopError("الطلب ما يحتاج إيصال.");
    await this.db.order.update({
      where: { id: order.id },
      data: { receiptMime: mime, receiptData: data, receiptUploadedAt: new Date(), status: "RECEIPT_UPLOADED" },
    });
    await this.notify(`🧾 إيصال جديد للطلب ${order.number} (${order.totalSar.toNumber()} ريال). راجعه من لوحة المتجر.`);
    if (order.manualFulfilment) await this.notifyManual(order.id, "تم رفع الإيصال — راجع التحويل");
  }

  /** Admin alert for orders with supplier="manual" items: buy them by hand from our other store. */
  async notifyManual(orderId: string, stage: string) {
    const o = await this.db.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { variant: { include: { product: true } } } } },
    });
    if (!o) return;
    const manual = o.items.filter((i) => i.variant.product.supplier === "manual");
    if (!manual.length) return;
    const address = [o.city, o.district, o.street, o.postalCode].filter(Boolean).join("، ");
    await this.notify(
      `🛍️ طلب يحتاج شراء يدوي من متجرنا الثاني (${stage})\n` +
        `رقم الطلب: ${o.number}\n` +
        manual.map((i) => `• ${i.variant.product.titleAr || i.title} × ${i.quantity}`).join("\n") +
        `\nالعميل: ${o.customerName}\nالجوال: ${o.phone}\nالعنوان: ${address}` +
        (o.notes ? `\nملاحظات: ${o.notes}` : "") +
        (manual.length < o.items.length ? `\n(باقي المنتجات تنرسل لـ CJ تلقائياً)` : ""),
    );
  }

  /** Admin records tracking / shipped / delivered for the manual part of an order. */
  async setManualFulfilment(orderId: string, tracking: string | undefined, status: "SHIPPED" | "DELIVERED" | undefined) {
    const o = await this.db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!o.manualFulfilment) throw new ShopError("الطلب ما فيه منتجات يدوية.");
    const t = tracking?.trim().slice(0, 500);
    const allManual = !o.cjOrderId;
    await this.db.order.update({
      where: { id: orderId },
      data: {
        ...(t !== undefined ? { manualTracking: t || null } : {}),
        ...(status ? { manualShippedAt: o.manualShippedAt ?? new Date() } : {}),
        ...(status && allManual ? { status } : {}),
      },
    });
  }

  /** Marks paid and pushes the order to CJ. Idempotent: won't create a second CJ order. */
  async markPaid(orderId: string, actor: string, paymentRef?: string) {
    const order = await this.db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (["CANCELLED"].includes(order.status)) throw new ShopError("الطلب ملغي.");
    if (!order.paidAt) {
      await this.db.order.update({
        where: { id: orderId },
        data: { status: "PAID", paidAt: new Date(), paidBy: actor, paymentRef: paymentRef ?? order.paymentRef },
      });
    }
    if (order.manualFulfilment && !order.paidAt) await this.notifyManual(orderId, "✅ تم تأكيد الدفع — اطلبه الحين");
    if (!order.cjOrderId) await this.pushToCj(orderId);
  }

  async pushToCj(orderId: string) {
    const order = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { include: { variant: { include: { product: true } } } } },
    });
    if (order.cjOrderId) return order.cjOrderId;
    // Manual-supplier items are never sent to CJ.
    const cjItems = order.items.filter((i) => i.variant.product.supplier !== "manual");
    if (!cjItems.length) return null;
    if (!this.cjEnabled) {
      await this.setStatus(orderId, "CJ_FAILED");
      await this.notify(`⚠️ الطلب ${order.number} مدفوع لكن CJ_API_KEY غير مضبوط.`);
      return null;
    }
    const payload = {
      orderNumber: order.number,
      shippingCountryCode: "SA",
      shippingCountry: "Saudi Arabia",
      shippingProvince: order.city,
      shippingCity: order.city,
      shippingAddress: [order.street, order.district].filter(Boolean).join(", "),
      shippingZip: order.postalCode || undefined,
      shippingCustomerName: order.customerName,
      shippingPhone: order.phone,
      logisticName: order.logisticName || this.config.defaultLogistic,
      fromCountryCode: "CN",
      payType: this.config.cjPayType,
      remark: order.notes || undefined,
      products: cjItems.map((i) => ({ vid: i.variant.cjVid, quantity: i.quantity, storeLineItemId: i.id })),
    };
    try {
      const res = await this.cj().createOrder(payload);
      await this.db.order.update({
        where: { id: orderId },
        data: { cjOrderId: res.orderId, cjOrderStatus: res.orderStatus ?? "CREATED", status: "CJ_CREATED", lastSyncedAt: new Date() },
      });
      await this.log("createOrder", order.number, true, res.orderId);
      await this.notify(
        `✅ الطلب ${order.number} انرسل لـ CJ (رقم CJ: ${res.orderId}).` +
          (this.config.cjPayType === 3 ? "\nادفع الطلب من رصيد CJ في لوحة CJ عشان يبدأ الشحن." : ""),
      );
      return res.orderId;
    } catch (error) {
      await this.setStatus(orderId, "CJ_FAILED");
      await this.log("createOrder", order.number, false, String(error), { ...payload, shippingPhone: "***" });
      await this.notify(`❌ فشل إنشاء طلب CJ للطلب ${order.number}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async cancel(orderId: string) {
    await this.setStatus(orderId, "CANCELLED");
  }

  private async setStatus(orderId: string, status: ShopOrderStatus) {
    await this.db.order.update({ where: { id: orderId }, data: { status } });
  }

  /** Pulls CJ status + tracking for open CJ orders; notifies admin on new tracking numbers. */
  async syncTracking(limit = 30) {
    if (!this.cjEnabled) return 0;
    const open = await this.db.order.findMany({
      where: { cjOrderId: { not: null }, status: { in: ["CJ_CREATED", "SHIPPED"] } },
      orderBy: { lastSyncedAt: "asc" },
      take: limit,
    });
    let changed = 0;
    for (const order of open) {
      try {
        const detail = await this.cj().orderDetail(order.cjOrderId!);
        let trackingStatus = order.trackingStatus;
        const tracking = detail.trackNumber || order.trackingNumber;
        if (tracking) {
          const info = await this.cj().trackInfo(tracking).catch(() => []);
          trackingStatus = info[0]?.trackingStatus ?? trackingStatus;
        }
        const delivered = /deliver/i.test(String(trackingStatus ?? "")) || /DELIVERED|FINISHED/i.test(detail.orderStatus ?? "");
        const status: ShopOrderStatus = delivered ? "DELIVERED" : tracking ? "SHIPPED" : order.status;
        await this.db.order.update({
          where: { id: order.id },
          data: {
            cjOrderStatus: detail.orderStatus ?? order.cjOrderStatus,
            trackingNumber: tracking ?? null,
            logisticName: detail.logisticName ?? order.logisticName,
            trackingStatus,
            status,
            lastSyncedAt: new Date(),
          },
        });
        if (tracking && tracking !== order.trackingNumber) {
          changed++;
          await this.notify(`📦 الطلب ${order.number} انشحن. رقم التتبع: ${tracking} (${detail.logisticName ?? ""})\nالعميل: ${order.customerName} ${order.phone}`);
        }
        if (status === "DELIVERED" && order.status !== "DELIVERED") await this.notify(`🎉 الطلب ${order.number} توصّل.`);
      } catch (error) {
        await this.log("sync", order.number, false, String(error));
      }
    }
    return changed;
  }
}

function normalizeImages(detail: CjProductDetail): string[] {
  const list: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) list.push(v);
  };
  if (Array.isArray(detail.productImageSet)) detail.productImageSet.forEach(push);
  const img = detail.productImage;
  if (Array.isArray(img)) img.forEach(push);
  else if (typeof img === "string") {
    try {
      const parsed = JSON.parse(img);
      if (Array.isArray(parsed)) parsed.forEach(push);
      else push(img);
    } catch {
      img.split(",").forEach((s) => push(s.trim()));
    }
  }
  return [...new Set(list)].slice(0, 12);
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
