import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import type { AppConfig } from "../config";
import { isSuperAdmin, parseWebhookStoreId } from "../config";
import { AppError } from "../domain/errors";
import { liveness, readiness } from "../infra/health";
import { formatPrice } from "../domain/price";
import { formatStoreStats, getStoreStats } from "../services/stats";
import { listUnmatchedUtterances } from "../services/unmatched";
import { listAdminStores, listStores } from "../services/store";
import {
  confirmSubscriptionPayment,
  expectedMonthlyRevenue,
  listPendingSubscriptionPayments,
  rejectSubscriptionPayment,
} from "../services/subscription";
import type { BotController } from "../bots/controller";
import {
  dashboardSecret,
  readDashboardUser,
  signDashboardUser,
  verifyTelegramLogin,
  type TelegramLoginPayload,
} from "./auth";
import { faviconSvg, logoSvg, ogSvg, telegramHref } from "./brand";
import { dash, DASHBOARD_ROOT, escapeHtml, loginPage, page } from "./html";
import { renderLanding } from "./landing";
import { saveScrimTemplateForm, scrimDetailHtml, scrimTemplatesHtml, scrimsIndexHtml } from "./scrims";

function send(res: ServerResponse, status: number, html: string, headers?: Record<string, string>) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function query(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function setUserCookie(token: string, secure: boolean) {
  const parts = [
    `psb_dash=${encodeURIComponent(token)}`,
    `Path=${DASHBOARD_ROOT}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (secure) parts.push("Secure");
  return { "set-cookie": parts.join("; ") };
}

function cookieSecure(config: AppConfig): boolean {
  return config.WEB_PUBLIC_URL.startsWith("https://");
}

function sendSvg(res: ServerResponse, svg: string) {
  res.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=86400",
  });
  res.end(svg);
}

function dashboardInner(pathname: string): string | null {
  if (pathname === DASHBOARD_ROOT) return "/";
  if (pathname.startsWith(`${DASHBOARD_ROOT}/`)) return pathname.slice(DASHBOARD_ROOT.length) || "/";
  return null;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string) {
  send(res, 302, "", { location });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function startHttpServer(
  config: AppConfig,
  db: PrismaClient,
  redis: Redis,
  platform?: BotController,
): Server {
  const secret = dashboardSecret(config.BOT_TOKEN, config.DASHBOARD_TOKEN);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", config.WEB_PUBLIC_URL || "http://127.0.0.1");
      if (url.pathname === "/health") {
        sendJson(res, 200, liveness());
        return;
      }
      if (url.pathname === "/ready") {
        const ready = await readiness(db, redis);
        sendJson(res, ready.ok ? 200 : 503, ready);
        return;
      }
      const read = req.method === "GET" || req.method === "HEAD";
      if (read && url.pathname === "/favicon.svg") {
        sendSvg(res, faviconSvg());
        return;
      }
      if (read && url.pathname === "/og.svg") {
        sendSvg(res, ogSvg());
        return;
      }
      if (read && url.pathname === "/logo.svg") {
        sendSvg(res, logoSvg(128));
        return;
      }
      if (read && url.pathname === "/") {
        const trialUrl = telegramHref(
          config.BOT_USERNAME || config.LANDING_CONTACT_TELEGRAM,
          config.ownerUsername,
        );
        const contactUrl = telegramHref(
          config.LANDING_CONTACT_TELEGRAM,
          config.BOT_USERNAME || config.ownerUsername,
        );
        send(
          res,
          200,
          renderLanding({
            publicUrl: config.WEB_PUBLIC_URL,
            trialUrl,
            contactUrl,
          }),
        );
        return;
      }
      if (platform && req.method === "POST") {
        const storeId = parseWebhookStoreId(url.pathname);
        if (storeId) {
          const ok = await platform.handleWebhook(storeId, req, res);
          if (ok) return;
          sendJson(res, 404, { ok: false, error: "unknown bot" });
          return;
        }
        if (url.pathname === "/telegram/webhook") {
          const first = await db.store.findFirst({
            where: { tokenCipher: { not: null } },
            orderBy: { createdAt: "asc" },
          });
          if (first && (await platform.handleWebhook(first.id, req, res))) return;
          sendJson(res, 404, { ok: false, error: "unknown bot" });
          return;
        }
      }
      await handle(req, res, config, db, secret, platform);
    } catch (error) {
      if (!res.headersSent) {
        const message = error instanceof AppError ? error.userMessage : String(error);
        send(res, 500, page("خطأ", `<p>صار خطأ في اللوحة.</p><pre>${escapeHtml(message)}</pre>`));
      }
    }
  });
  server.listen(config.WEB_PORT);
  return server;
}

async function currentUser(
  req: IncomingMessage,
  config: AppConfig,
  secret: string,
): Promise<string | null> {
  const cookies = parseCookies(req);
  const telegramId = readDashboardUser(cookies.psb_dash, secret);
  if (!telegramId) return null;
  if (isSuperAdmin(config, telegramId) || telegramId === config.OWNER_TELEGRAM_ID) return telegramId;
  return null;
}

function loginOk(res: ServerResponse, config: AppConfig, secret: string, telegramId: string) {
  const signed = signDashboardUser(telegramId, secret);
  send(res, 303, "", {
    location: dash("/stores"),
    ...setUserCookie(signed, cookieSecure(config)),
  });
}

async function tryDashboardTokenLogin(
  res: ServerResponse,
  config: AppConfig,
  secret: string,
  token: string,
): Promise<boolean> {
  const expected = config.DASHBOARD_TOKEN.trim();
  if (!expected || token !== expected) return false;
  loginOk(res, config, secret, config.superAdminTelegramId);
  return true;
}

const LEGACY_DASHBOARD: Record<string, string> = {
  "/login": dash("/login"),
  "/logout": dash("/logout"),
  "/stores": dash("/stores"),
  "/subscriptions": dash("/subscriptions"),
  "/inquiries": dash("/inquiries"),
  "/payments": dash("/payments"),
  "/stats": dash("/stats"),
  "/unmatched": dash("/unmatched"),
  "/scrims": dash("/scrims"),
  "/scrim-templates": dash("/scrim-templates"),
  "/auth/telegram": dash("/auth/telegram"),
};

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: AppConfig,
  db: PrismaClient,
  secret: string,
  platform?: BotController,
) {
  const url = new URL(req.url ?? "/", config.WEB_PUBLIC_URL || "http://127.0.0.1");
  const legacy = LEGACY_DASHBOARD[url.pathname];
  if (legacy) {
    const suffix = url.search || "";
    redirect(res, `${legacy}${suffix}`);
    return;
  }
  if (
    url.pathname.startsWith("/stores/") ||
    url.pathname.startsWith("/subscriptions/") ||
    url.pathname.startsWith("/scrims/") ||
    url.pathname.startsWith("/scrim-templates/")
  ) {
    redirect(res, `${dash(url.pathname)}${url.search || ""}`);
    return;
  }

  const inner = dashboardInner(url.pathname);
  if (inner === "/login") {
    if (req.method === "POST") {
      const token = parseForm(await readBody(req)).token?.trim() ?? "";
      if (await tryDashboardTokenLogin(res, config, secret, token)) return;
      send(res, 401, loginPage(config.BOT_USERNAME, config.WEB_PUBLIC_URL, "الرمز غير صحيح."));
      return;
    }
    const token = query(url).token?.trim() ?? "";
    if (token && (await tryDashboardTokenLogin(res, config, secret, token))) return;
    send(res, 200, loginPage(config.BOT_USERNAME, config.WEB_PUBLIC_URL));
    return;
  }
  if (inner === "/auth/telegram") {
    const payload = query(url) as unknown as TelegramLoginPayload;
    payload.id = Number(payload.id);
    payload.auth_date = Number(payload.auth_date);
    if (!verifyTelegramLogin(payload, config.BOT_TOKEN)) {
      send(res, 403, page("مرفوض", "<p>دخول تلقرام غير صحيح.</p>", { nav: false }));
      return;
    }
    const telegramId = String(payload.id);
    if (!isSuperAdmin(config, telegramId) && telegramId !== config.OWNER_TELEGRAM_ID) {
      send(res, 403, page("مرفوض", "<p>هالحساب مو مالك المنصة.</p>", { nav: false }));
      return;
    }
    loginOk(res, config, secret, telegramId);
    return;
  }
  if (inner === "/logout") {
    send(res, 302, "", {
      location: dash("/login"),
      "set-cookie": `psb_dash=; Path=${DASHBOARD_ROOT}; Max-Age=0`,
    });
    return;
  }

  if (inner === null) {
    send(res, 404, page("غير موجود", "<p>هالصفحة مو موجودة.</p><p><a href=\"/\">الصفحة الرئيسية</a></p>", { nav: false }));
    return;
  }

  const user = await currentUser(req, config, secret);
  if (!user) {
    send(res, 302, "", { location: dash("/login") });
    return;
  }

  const dashUrl = new URL(url.toString());
  dashUrl.pathname = inner;

  if (req.method === "POST") {
    const templateAction = inner.match(/^\/scrim-templates\/([^/]+)$/);
    if (templateAction) {
      try {
        const form = parseForm(await readBody(req));
        await saveScrimTemplateForm(db, templateAction[1], form);
        redirect(res, dash("/scrim-templates"));
      } catch (error) {
        const message = error instanceof AppError ? error.userMessage : "ما حفظنا القالب.";
        send(res, 400, page("خطأ", `<p>${escapeHtml(message)}</p>`));
      }
      return;
    }
  }

  if (req.method === "POST" && platform) {
    const handled = await handlePlatformPost(req, res, dashUrl, db, user, platform);
    if (handled) return;
  }

  if (inner === "/stores" || inner === "/") {
    if (inner === "/") {
      await renderListings(res, db);
      return;
    }
    await renderStores(res, db, config);
    return;
  }

  if (inner === "/subscriptions") {
    await renderSubscriptions(res, db);
    return;
  }

  if (inner === "/scrims") {
    send(res, 200, page("السكرمات", await scrimsIndexHtml(db)));
    return;
  }

  const scrimDetail = inner.match(/^\/scrims\/([^/]+)$/);
  if (scrimDetail) {
    const html = await scrimDetailHtml(db, scrimDetail[1]);
    if (!html) {
      send(res, 404, page("غير موجود", "<p>ما لقيت هالسكرم.</p>"));
      return;
    }
    send(res, 200, page("سكرم", html));
    return;
  }

  if (inner === "/scrim-templates") {
    send(res, 200, page("قوالب السكرم", await scrimTemplatesHtml(db)));
    return;
  }

  if (inner === "/inquiries") {
    const rows = await db.inquiry.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { listing: { include: { store: true } } },
    });
    const body = `<h1>الاستفسارات</h1><table><tr><th>الإعلان</th><th>المتجر</th><th>الحالة</th><th>المشتري</th></tr>${rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.listing.shortCode)}</td><td>${escapeHtml(row.listing.store.title || row.listing.store.ownerUsername)}</td><td>${escapeHtml(row.status)}</td><td><code>${escapeHtml(row.buyerTelegramId)}</code></td></tr>`,
      )
      .join("")}</table>`;
    send(res, 200, page("الاستفسارات", body));
    return;
  }

  if (inner === "/payments") {
    const rows = await db.payment.findMany({
      take: 50,
      orderBy: { createdAt: "desc" },
      include: { listing: { include: { store: true } } },
    });
    const body = `<h1>إيصالات الإعلانات</h1><table><tr><th>الإعلان</th><th>المبلغ</th><th>الحالة</th></tr>${rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.listing.shortCode)}</td><td>${escapeHtml(formatPrice(row.amount.toNumber()))}</td><td>${escapeHtml(row.status)}</td></tr>`,
      )
      .join("")}</table>`;
    send(res, 200, page("المدفوعات", body));
    return;
  }

  if (inner === "/unmatched") {
    const rows = await listUnmatchedUtterances(db, 80);
    const body = `<h1>محادثات ما فهمها البوت</h1>
<p>هذي الرسائل اللي فشل فيها الفهم. نطور منها المعجم والتعليمات. أضف مصطلحات المتجر من الإعدادات.</p>
<table><tr><th>الوقت</th><th>المتجر</th><th>المستخدم</th><th>السبب</th><th>النص</th></tr>${rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.createdAt.toISOString())}</td><td>${escapeHtml(row.store?.title || row.store?.ownerUsername || "—")}</td><td><code>${escapeHtml(row.telegramId)}</code></td><td>${escapeHtml(row.reason)}</td><td>${escapeHtml(row.text)}</td></tr>`,
      )
      .join("")}</table>`;
    send(res, 200, page("غير مفهومة", body));
    return;
  }

  if (inner === "/stats") {
    const stores = await listStores(db);
    const blocks = [];
    for (const store of stores) {
      const stats = await getStoreStats(db, store.id);
      blocks.push(`<div class="card"><pre>${escapeHtml(formatStoreStats(stats))}</pre></div>`);
    }
    send(res, 200, page("الإحصائيات", `<h1>الإحصائيات</h1>${blocks.join("")}`));
    return;
  }

  send(res, 404, page("غير موجود", "<p>هالصفحة مو موجودة.</p>"));
}

async function renderListings(res: ServerResponse, db: PrismaClient) {
  const listings = await db.listing.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
    include: { store: true },
  });
  const body = `<h1>الإعلانات</h1><table><tr><th>الرقم</th><th>المتجر</th><th>السعر</th><th>الحالة</th></tr>${listings
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.shortCode)}</td><td>${escapeHtml(row.store.title || row.store.ownerUsername)}</td><td>${escapeHtml(formatPrice(row.price.toNumber()))}</td><td>${escapeHtml(row.status)}</td></tr>`,
    )
    .join("")}</table>`;
  send(res, 200, page("الإعلانات", body));
}

async function renderStores(res: ServerResponse, db: PrismaClient, config: AppConfig) {
  const stores = await listAdminStores(db);
  const revenue = expectedMonthlyRevenue(stores, config.SUBSCRIPTION_PRICE_SAR);
  const rows = stores
    .map((store) => {
      const until = store.subscriptionExpiresAt
        ? store.subscriptionExpiresAt.toISOString().slice(0, 16).replace("T", " ")
        : "—";
      return `<tr>
        <td>@${escapeHtml(store.botUsername || "—")}<br/><span class="muted">${escapeHtml(store.botFirstName || store.title)}</span></td>
        <td><code>${escapeHtml(store.channelId || "غير مربوط")}</code></td>
        <td>@${escapeHtml(store.ownerUsername || "—")}<br/><code>${escapeHtml(store.ownerTelegramId || "—")}</code></td>
        <td>${escapeHtml(store.runtimeStatus)}</td>
        <td>${escapeHtml(until)}</td>
        <td>${store.listingCount}</td>
        <td class="row-actions">
          <form method="post" action="${dash(`/stores/${store.id}/enable`)}"><button>تفعيل</button></form>
          <form method="post" action="${dash(`/stores/${store.id}/disable`)}"><button>إيقاف</button></form>
          <form method="post" action="${dash(`/stores/${store.id}/extend`)}"><input type="hidden" name="days" value="30" /><button>تمديد 30 يوم</button></form>
          <form method="post" action="${dash(`/stores/${store.id}/delete`)}" onsubmit="return confirm('حذف توكن هذا البوت؟')"><button>حذف</button></form>
        </td>
      </tr>`;
    })
    .join("");
  const body = `<h1>المتاجر</h1>
  <div class="card">
    <p>متاجر نشطة/تجربة: <b>${revenue.activeStores}</b> · دخل شهري متوقع: <b>${revenue.expectedMonthly}</b> ريال</p>
    <form method="post" action="${dash("/stores/add")}">
      <p>إضافة متجر: الصق توكن البوت من BotFather</p>
      <textarea name="token" rows="2" required placeholder="123456:AA..."></textarea>
      <p><button>تحقق وشغّل</button></p>
    </form>
  </div>
  <table>
    <tr><th>البوت</th><th>القناة/المجموعة</th><th>المالك</th><th>الحالة</th><th>الانتهاء</th><th>إعلانات</th><th></th></tr>
    ${rows || `<tr><td colspan="7">ما فيه متاجر.</td></tr>`}
  </table>`;
  send(res, 200, page("المتاجر", body));
}

async function renderSubscriptions(res: ServerResponse, db: PrismaClient) {
  const rows = await listPendingSubscriptionPayments(db);
  const body = `<h1>إيصالات الاشتراك</h1>
  <table>
    <tr><th>المتجر</th><th>المبلغ</th><th>الدافع</th><th>الوقت</th><th></th></tr>
    ${
      rows.length
        ? rows
            .map(
              (row) => `<tr>
      <td>${escapeHtml(row.store.title || row.store.botUsername)}</td>
      <td>${escapeHtml(String(row.amount.toNumber()))} ريال</td>
      <td><code>${escapeHtml(row.payerTelegramId)}</code></td>
      <td>${escapeHtml(row.createdAt.toISOString())}</td>
      <td class="row-actions">
        <form method="post" action="${dash(`/subscriptions/${row.id}/confirm`)}"><button>تأكيد</button></form>
        <form method="post" action="${dash(`/subscriptions/${row.id}/reject`)}"><button>رفض</button></form>
      </td>
    </tr>`,
            )
            .join("")
        : `<tr><td colspan="5">ما فيه إيصالات معلّقة.</td></tr>`
    }
  </table>`;
  send(res, 200, page("الاشتراكات", body));
}

async function handlePlatformPost(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  db: PrismaClient,
  user: string,
  platform: BotController,
): Promise<boolean> {
  const add = url.pathname === "/stores/add";
  const storeAction = url.pathname.match(/^\/stores\/([^/]+)\/(enable|disable|extend|delete)$/);
  const payAction = url.pathname.match(/^\/subscriptions\/([^/]+)\/(confirm|reject)$/);
  if (!add && !storeAction && !payAction) return false;

  const form = parseForm(await readBody(req));
  try {
    if (add) {
      const token = (form.token ?? "").trim();
      if (!token) throw new AppError("missing token", "الصق توكن البوت.", "INVALID_BOT_TOKEN");
      await platform.addFromToken(token, user);
      redirect(res, dash("/stores"));
      return true;
    }
    if (storeAction) {
      const storeId = storeAction[1];
      const action = storeAction[2];
      if (action === "enable") await platform.setEnabled(storeId, true, user);
      if (action === "disable") await platform.setEnabled(storeId, false, user);
      if (action === "delete") await platform.remove(storeId, user);
      if (action === "extend") {
        const days = Number(form.days || "30");
        if (!Number.isInteger(days) || days <= 0 || days > 365) {
          throw new AppError("bad days", "عدد الأيام غير صحيح.", "INVALID_DAYS");
        }
        await platform.extend(storeId, days, user);
      }
      redirect(res, dash("/stores"));
      return true;
    }
    if (payAction) {
      const paymentId = payAction[1];
      if (payAction[2] === "confirm") {
        const result = await confirmSubscriptionPayment(db, {
          paymentId,
          actorTelegramId: user,
        });
        const until = result.store.subscriptionExpiresAt?.toISOString().slice(0, 10) ?? "";
        await platform.sendStoreMessage(
          result.store.id,
          result.payment.payerTelegramId,
          `تم تأكيد الاشتراك ✅ صالح حتى ${until}`,
        );
      } else {
        await rejectSubscriptionPayment(db, { paymentId, actorTelegramId: user });
      }
      redirect(res, dash("/subscriptions"));
      return true;
    }
  } catch (error) {
    const message = error instanceof AppError ? error.userMessage : "صار خطأ.";
    send(
      res,
      400,
      page("خطأ", `<p>${escapeHtml(message)}</p><p><a href="${dash("/stores")}">رجوع للمتاجر</a></p>`),
    );
    return true;
  }
  return false;
}
