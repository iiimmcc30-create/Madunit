export const DASHBOARD_ROOT = "/dashboard";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function dash(path = ""): string {
  if (!path || path === "/") return DASHBOARD_ROOT;
  return `${DASHBOARD_ROOT}${path.startsWith("/") ? path : `/${path}`}`;
}

export function page(title: string, body: string, options?: { nav?: boolean }): string {
  const nav =
    options?.nav === false
      ? ""
      : `<header>
    <strong>لوحة المالك</strong>
    <nav>
      <a href="${dash("/stores")}">المتاجر</a>
      <a href="${dash("/subscriptions")}">الاشتراكات</a>
      <a href="${dash("/")}">الإعلانات</a>
      <a href="${dash("/inquiries")}">الاستفسارات</a>
      <a href="${dash("/scrims")}">السكرمات</a>
      <a href="${dash("/scrim-templates")}">قوالب السكرم</a>
      <a href="${dash("/payments")}">الإيصالات</a>
      <a href="${dash("/stats")}">الإحصائيات</a>
      <a href="${dash("/unmatched")}">غير مفهومة</a>
      <a href="/">الموقع</a>
      <a href="${dash("/logout")}">خروج</a>
    </nav>
  </header>`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    body { font-family: Tahoma, Arial, sans-serif; margin: 0; background: #0A1A3F; color: #f8fafc; }
    a { color: #8cb6ff; }
    header, main { max-width: 980px; margin: 0 auto; padding: 16px; }
    nav a { margin-left: 12px; }
    table { width: 100%; border-collapse: collapse; background: #122454; }
    th, td { text-align: right; padding: 8px; border-bottom: 1px solid #1f2f5c; }
    .card { background: #122454; padding: 16px; border-radius: 16px; margin: 12px 0; }
    input, textarea { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 12px; border: 1px solid #334155; background: #0A1A3F; color: #f8fafc; }
    button { background: #2F7BFF; color: #fff; border: 0; padding: 8px 12px; border-radius: 12px; cursor: pointer; font-family: inherit; }
    .row-actions form { display: inline-block; margin-left: 6px; }
    .muted { color: #94a3b8; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  ${nav}
  <main>${body}</main>
</body>
</html>`;
}

export function loginPage(botUsername: string, publicUrl: string, error = ""): string {
  const authUrl = `${publicUrl.replace(/\/$/, "")}${dash("/auth/telegram")}`;
  const widget = botUsername
    ? `<script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="${escapeHtml(botUsername)}" data-size="large" data-auth-url="${escapeHtml(authUrl)}" data-request-access="write"></script>`
    : `<p class="muted">دخول تلقرام يحتاج BOT_USERNAME في الإنتاج. محليًا استخدم رمز اللوحة.</p>`;
  const err = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return page(
    "دخول اللوحة",
    `<div class="card">
      <h1>دخول المالك</h1>
      ${err}
      <form method="post" action="${dash("/login")}">
        <p>رمز اللوحة (DASHBOARD_TOKEN)</p>
        <input type="password" name="token" required autocomplete="current-password" placeholder="الصق الرمز" />
        <p><button>دخول</button></p>
      </form>
      <hr style="border-color:#1f2f5c" />
      <p>أو دخول تلقرام:</p>
      ${widget}
    </div>`,
    { nav: false },
  );
}

export { escapeHtml };
