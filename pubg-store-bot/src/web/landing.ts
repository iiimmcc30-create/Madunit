import { DEFAULT_MONTHLY_PRICE_SAR } from "../domain/subscription";
import { BRAND_NAME, logoSvg } from "./brand";
import { escapeHtml } from "./html";

export interface LandingInput {
  publicUrl: string;
  trialUrl: string;
  contactUrl: string;
}

export function renderLanding(input: LandingInput): string {
  const url = escapeHtml(input.publicUrl.replace(/\/$/, ""));
  const trial = escapeHtml(input.trialUrl);
  const contact = escapeHtml(input.contactUrl);
  const desc =
    "البوت ينشر الإعلانات، يرد على المشترين، ويرجع للبائع ويجيب لك آخر سعر، وكل هذا وأنت مرتاح.";
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${BRAND_NAME} — وكيلك الذكي لقناتك</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <link rel="canonical" href="${url}/" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${BRAND_NAME}" />
  <meta property="og:title" content="${BRAND_NAME} — وكيلك الذكي لقناتك" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:url" content="${url}/" />
  <meta property="og:image" content="${url}/og.svg" />
  <meta property="og:locale" content="ar_SA" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${BRAND_NAME} — وكيلك الذكي لقناتك" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  <meta name="twitter:image" content="${url}/og.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet" />
  <style>
    :root { --navy:#0A1A3F; --blue:#2F7BFF; --card:#122454; --white:#fff; --muted:#b7c7e8; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin:0; font-family: Tajawal, Tahoma, Arial, sans-serif; background: var(--navy); color: var(--white); line-height:1.7; }
    a { color: var(--blue); text-decoration: none; }
    img, svg { display:block; }
    .wrap { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
    header { position: sticky; top:0; z-index: 20; backdrop-filter: blur(12px); background: rgba(10,26,63,.86); border-bottom: 1px solid rgba(47,123,255,.18); }
    .nav { display:flex; align-items:center; justify-content:space-between; gap:16px; padding: 14px 0; }
    .brand { display:flex; align-items:center; gap:10px; color:#fff; font-weight:800; }
    .btn { display:inline-flex; align-items:center; justify-content:center; background: var(--blue); color:#fff; border:0; border-radius: 999px; padding: 12px 22px; font-weight:700; font-family: inherit; cursor:pointer; transition: transform .18s ease, box-shadow .18s ease, background .18s ease; box-shadow: 0 8px 24px rgba(47,123,255,.28); }
    .btn:hover { transform: translateY(-1px); background:#4b8dff; }
    .btn-ghost { background: transparent; box-shadow:none; border:1px solid rgba(255,255,255,.18); }
    .hero { display:grid; grid-template-columns: 1.15fr .85fr; gap: 40px; align-items:center; padding: 72px 0 48px; }
    .hero h1 { font-size: clamp(2rem, 5vw, 3.4rem); line-height:1.25; margin: 0 0 16px; }
    .hero p { color: var(--muted); font-size: 1.15rem; margin: 0 0 28px; }
    .hero-card { background: linear-gradient(180deg, rgba(47,123,255,.16), rgba(18,36,84,.7)); border:1px solid rgba(47,123,255,.28); border-radius: 28px; padding: 28px; min-height: 280px; display:flex; flex-direction:column; justify-content:center; gap:14px; }
    .pill { display:inline-flex; width: fit-content; background: rgba(47,123,255,.16); color:#d6e6ff; border-radius:999px; padding:6px 12px; font-size:.9rem; }
    section { padding: 56px 0; }
    h2 { font-size: clamp(1.5rem, 3vw, 2.1rem); margin: 0 0 28px; }
    .grid-3, .grid-2, .features { display:grid; gap: 16px; }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-2 { grid-template-columns: 1fr 1fr; }
    .features { grid-template-columns: repeat(3, 1fr); }
    .card { background: var(--card); border: 1px solid rgba(47,123,255,.16); border-radius: 22px; padding: 22px; transition: transform .18s ease, border-color .18s ease; }
    .card:hover { transform: translateY(-3px); border-color: rgba(47,123,255,.42); }
    .step { font-size: .85rem; color: var(--blue); font-weight:700; }
    .price { text-align:center; padding: 36px; }
    .price b { font-size: 2.4rem; }
    details { background: var(--card); border-radius: 16px; padding: 14px 18px; border: 1px solid rgba(47,123,255,.14); }
    summary { cursor:pointer; font-weight:700; }
    footer { border-top: 1px solid rgba(47,123,255,.18); padding: 28px 0 40px; color: var(--muted); }
    .foot { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
    @media (max-width: 840px) {
      .hero, .grid-3, .grid-2, .features { grid-template-columns: 1fr; }
      .hero { padding-top: 36px; }
      .nav .btn-ghost { display:none; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap nav">
      <a class="brand" href="/">${logoSvg(36)} ${BRAND_NAME}</a>
      <div style="display:flex; gap:8px;">
        <a class="btn btn-ghost" href="/dashboard">لوحة المالك</a>
        <a class="btn" href="${trial}">جرّب يومين مجانًا</a>
      </div>
    </div>
  </header>
  <main>
    <section class="wrap hero">
      <div>
        <div class="pill">بوت قنوات بيع حسابات ببجي</div>
        <h1>وكيلك الذكي لقناتك</h1>
        <p>البوت ينشر الإعلانات، يرد على المشترين، ويرجع للبائع ويجيب لك آخر سعر، وكل هذا وأنت مرتاح.</p>
        <a class="btn" href="${trial}">جرّب يومين مجانًا</a>
      </div>
      <div class="hero-card">
        ${logoSvg(88)}
        <strong>من الرسالة إلى القناة أو المجموعة… بدون ما تظهر.</strong>
        <span style="color:var(--muted)">البائع يرسل، البوت ينشر بيوزرك، والمشتري يسأل والتحقق يمشي لحاله.</span>
      </div>
    </section>
    <section class="wrap">
      <h2>كيف يشتغل</h2>
      <div class="grid-3">
        <article class="card"><div class="step">1</div><h3>البائع يرسل</h3><p>فيديو الحساب ووصف حر باللهجة. البوت يلتقط الناقص فقط.</p></article>
        <article class="card"><div class="step">2</div><h3>البوت ينشر بيوزرك</h3><p>الإعلان ينزل في القناة أو المجموعة باسم المتجر. يوزر البائع ما يظهر.</p></article>
        <article class="card"><div class="step">3</div><h3>المشتري يسأل والبوت يتحقق</h3><p>يسأل عن رقم الإعلان، البوت يرجع للبائع ويجيب آخر سعر، ويحوّل الشراء لك.</p></article>
      </div>
    </section>
    <section class="wrap">
      <h2>المميزات</h2>
      <div class="features">
        <article class="card"><h3>نشر فوري</h3><p>من الخاص إلى القناة أو المجموعة خلال ثوانٍ، مع معاينة قبل الاعتماد.</p></article>
        <article class="card"><h3>يفهم العامية</h3><p>مصطلحات ببجي واللهجة السعودية داخل المحادثة، مو قوائم جامدة.</p></article>
        <article class="card"><h3>إخفاء البائع</h3><p>التواصل والشراء عن طريقك. القناة أو المجموعة ما فيها يوزرات بائعين.</p></article>
        <article class="card"><h3>بوت باسم متجرك</h3><p>كل متجر (قناة أو مجموعة) بوته الخاص، معزول عن المتاجر الثانية.</p></article>
        <article class="card"><h3>تقارير ولوحة تحكم</h3><p>المتاجر، الاشتراكات، الإيصالات، والإحصائيات في مكان واحد.</p></article>
        <article class="card"><h3>قريبًا: تنظيم السكرمات</h3><p>ميزة جديدة على الطريق.</p></article>
      </div>
    </section>
    <section class="wrap">
      <h2>التسعير</h2>
      <div class="card price">
        <div class="pill">بدون حد للإعلانات</div>
        <p>يومين تجربة مجانًا، بعدها</p>
        <p><b>${DEFAULT_MONTHLY_PRICE_SAR}</b> ريال / شهر</p>
        <p style="color:var(--muted)">الدفع بتحويل بنكي محلي، ثم إرسال صورة الإيصال من البوت.</p>
        <a class="btn" href="${trial}">ابدأ التجربة</a>
      </div>
    </section>
    <section class="wrap">
      <h2>أسئلة شائعة</h2>
      <div style="display:grid; gap:10px;">
        <details open><summary>هل أحتاج خبرة تقنية؟</summary><p>لا. تربط قناتك أو مجموعتك من البوت (/setup أو /bind داخل المجموعة)، والبائع يرسل فيديو ووصف.</p></details>
        <details><summary>وش يصير بعد اليومين؟</summary><p>تجدد الاشتراك بتحويل ${DEFAULT_MONTHLY_PRICE_SAR} ريال، وتأكد الإيصال من اللوحة أو من البوت.</p></details>
        <details><summary>هل يظهر رقم البائع في القناة أو المجموعة؟</summary><p>لا. الإعلان ينزل بيوزر المالك فقط.</p></details>
        <details><summary>أقدر أستخدم بوتي أنا؟</summary><p>إي، تضيف توكن البوت من لوحة المالك ويشتغل باسم متجرك.</p></details>
      </div>
    </section>
  </main>
  <footer>
    <div class="wrap foot">
      <div>© ${new Date().getFullYear()} ${BRAND_NAME}. جميع الحقوق محفوظة.</div>
      <a href="${contact}">تواصل عبر تلقرام</a>
    </div>
  </footer>
</body>
</html>`;
}
