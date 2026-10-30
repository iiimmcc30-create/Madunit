import type { Order, OrderItem, Product, ProductVariant } from "@prisma/client";
import { CAROUSEL_CSS, CAROUSEL_JS, carouselHtml } from "./carousel";
import { bankTransfer } from "./service";

export function esc(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHOP_CSS = `
.shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px;margin:24px 0}
.pcard{background:var(--card);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column;text-decoration:none;color:var(--tx);transition:border-color .2s}
.pcard:hover{border-color:var(--line-strong)}
.pcard img{aspect-ratio:1;object-fit:cover;width:100%;background:#0e1016}
.pcard .pb{padding:14px;display:flex;flex-direction:column;gap:6px;flex:1}
.pcard h3{font-size:16px;margin:0;line-height:1.5}
.price{font-weight:800;color:var(--ok-tx);font-size:19px}
.pdp{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}
@media(max-width:800px){.pdp{grid-template-columns:1fr}}
.gallery img{border-radius:var(--r-sm);border:1px solid var(--line);width:100%}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.thumbs img{width:64px;height:64px;object-fit:cover;cursor:pointer}
.shop-form{display:grid;gap:12px;max-width:560px}
.shop-form label{display:grid;gap:4px;font-weight:500}
.shop-form input,.shop-form select,.shop-form textarea{background:var(--surface);color:var(--tx);border:1px solid var(--line-strong);border-radius:12px;padding:11px 12px;font:inherit}
.cart-row{display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--line);padding:12px 0}
.cart-row img{width:64px;height:64px;object-fit:cover;border-radius:10px}
.cart-row .grow{flex:1}
.qty{width:64px}
.note{color:var(--mu);font-size:15px}
.alert{border:1px solid var(--ok-line);background:var(--ok-soft);border-radius:var(--r-sm);padding:14px}
.err{color:#fca5a5}
.was{color:var(--mu);text-decoration:line-through;font-size:15px;margin-inline-start:8px;font-weight:500}
.feat{position:absolute;top:10px;inset-inline-start:10px;background:#3b82f6;color:#fff;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700}
.pcard{position:relative}
.promo2{display:block;margin:22px 0;border-radius:18px;overflow:hidden}.promo2 img{width:100%;height:auto;display:block}
${CAROUSEL_CSS}
.cart-link b{background:var(--ac);color:#fff;border-radius:99px;padding:0 8px;margin-inline-start:4px;font-size:13px}
`;

const CART_JS = `
window.MUCart=(function(){var K='mu_cart_v1';
function get(){try{return JSON.parse(localStorage.getItem(K)||'[]')}catch(e){return[]}}
function set(c){localStorage.setItem(K,JSON.stringify(c));badge()}
function add(item){var c=get(),f=c.find(function(x){return x.variantId===item.variantId});if(f)f.quantity=Math.min(20,f.quantity+item.quantity);else c.push(item);set(c)}
function badge(){var n=get().reduce(function(s,x){return s+x.quantity},0);document.querySelectorAll('[data-cart-count]').forEach(function(e){e.textContent=n})}
document.addEventListener('DOMContentLoaded',badge);return{get:get,set:set,add:add,badge:badge}})();
`;

export const SITE = "https://madunitstore.com";
export const SITE_TITLE = "Mad Unit Store | متجر إكسسوارات ألعاب الجوال";
export const SITE_DESCRIPTION =
  "Mad Unit Store (ماد يونت): متجر إكسسوارات ألعاب الجوال في السعودية — مبردات جوال وآيباد، أصابع ببجي وملحقات القيمرز بتوصيل لكل المدن، وبيع وشراء حسابات الألعاب بأمان عبر تيليجرام.";
const abs = (u: string) => (/^https?:/.test(u) ? u : SITE + u);
const SITE_JSONLD = JSON.stringify([
  { "@context": "https://schema.org", "@type": "WebSite", name: "Mad Unit Store", alternateName: "ماد يونت", url: SITE + "/" },
  { "@context": "https://schema.org", "@type": "Organization", name: "Mad Unit Store", alternateName: "ماد يونت", url: SITE + "/", logo: SITE + "/assets/logo.png", sameAs: ["https://t.me/MadUnitStore"] },
]).replace(/</g, "\\u003c");

export function shopPage(title: string, body: string, opts?: { description?: string; script?: string; image?: string; fullTitle?: string }): string {
  const fullTitle = opts?.fullTitle ?? `${title} | Mad Unit Store`;
  const desc = opts?.description ?? SITE_DESCRIPTION;
  return `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:site_name" content="Mad Unit Store"><meta property="og:type" content="website"><meta property="og:locale" content="ar_SA">
<meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(opts?.image ? abs(opts.image) : SITE + "/assets/logo.png")}"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${SITE_JSONLD}</script>
<link rel="icon" href="/favicon.ico?v=10"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=10"><meta name="theme-color" content="#000000"><link rel="stylesheet" href="/css/site.css?v=10">
<style>${SHOP_CSS}</style>
<script>${CART_JS}</script>
</head><body>
<header class="top"><div class="wrap nav">
 <a class="brand" href="/"><img src="/assets/logo.jpg?v=10" alt="شعار Mad Unit Store" width="40" height="40"><span>Mad Unit Store</span></a>
 <nav id="site-nav" aria-label="القائمة"><a href="/shop">المتجر</a><a class="cart-link" href="/shop/cart">السلة<b data-cart-count>0</b></a><a href="/#accounts">بيع وشراء الحسابات</a><a href="/">الرئيسية</a></nav>
</div></header>
<main id="main" class="wrap">${body}</main>
<footer class="foot"><div class="wrap">
 <p>© 2026 متجر ماد يونيت — متجر ملحقات وإكسسوارات ألعاب الجوال — جميع الحقوق محفوظة · س.ت 7053799925</p>
 <p class="links"><a href="https://t.me/MadUnitStore" target="_blank" rel="noopener">t.me/MadUnitStore</a> · <a href="https://t.me/iir8rr" target="_blank" rel="noopener">@iir8rr</a> · <a class="ph" href="tel:+966557345682">0557345682</a> · <a href="https://wa.me/966557345682" target="_blank" rel="noopener">واتساب</a></p>
</div></footer>
${opts?.script ? `<script>${opts.script}</script>` : ""}
</body></html>`;
}

type ProductWithVariants = Product & { variants: ProductVariant[] };

function title(p: Product) {
  return p.titleAr || p.titleEn;
}

function priceHtml(p: ProductWithVariants): string {
  const now = fromPrice(p);
  const was = p.compareAtSar?.toNumber();
  return `${now} ر.س${was && was > now ? `<s class="was">${was} ر.س</s>` : ""}`;
}

function fromPrice(p: ProductWithVariants): number {
  const prices = p.variants.map((v) => v.priceSar.toNumber());
  return prices.length ? Math.min(...prices) : p.priceSar.toNumber();
}

export function productListHtml(products: ProductWithVariants[]): string {
  const cards = products
    .map(
      (p) => `<a class="pcard" href="/shop/p/${esc(p.slug)}">${p.featured ? `<span class="feat">مميز</span>` : ""}
  <img src="${esc(p.images[0] ?? "/assets/logo.jpg")}" alt="${esc(title(p))}" loading="lazy">
  <div class="pb"><h3>${esc(title(p))}</h3><span class="price">${priceHtml(p)}</span></div></a>`,
    )
    .join("");
  return shopPage(
    "المتجر",
    `${carouselHtml()}<section class="sec"><p class="eyebrow">إكسسوارات الألعاب والجوال</p><h1>متجر ماد يونيت</h1>
<p class="lead">منتجات مختارة للاعبين، توصيل لكل مدن المملكة.</p>
${products.length ? `<div class="shop-grid">${cards}</div>` : `<p class="note">ما فيه منتجات منشورة حالياً. ارجع قريب!</p>`}
<a class="promo2" href="/shop/p/memo-cx08-pro"><img src="/uploads/shop/banner2.jpg" alt="العب بدون حرارة ولا تعليق" loading="lazy"></a></section>`,
    { script: CAROUSEL_JS, fullTitle: SITE_TITLE },
  );
}

export function productPageHtml(p: ProductWithVariants): string {
  const images = p.images.length ? p.images : ["/assets/logo.jpg"];
  const opts = p.variants
    .map((v) => `<option value="${esc(v.id)}" data-price="${v.priceSar.toNumber()}" data-img="${esc(v.image ?? "")}">${esc(v.name || "افتراضي")} — ${v.priceSar.toNumber()} ر.س</option>`)
    .join("");
  const desc = p.descriptionAr || "";
  const script = `
var sel=document.getElementById('variant'),pr=document.getElementById('price'),main=document.getElementById('main-img');
function upd(){var o=sel.options[sel.selectedIndex];pr.textContent=o.dataset.price+' ر.س';if(o.dataset.img)main.src=o.dataset.img}
sel&&sel.addEventListener('change',upd);
document.querySelectorAll('.thumbs img').forEach(function(t){t.onclick=function(){main.src=t.src}});
document.getElementById('add').onclick=function(){var o=sel.options[sel.selectedIndex];
MUCart.add({variantId:o.value,quantity:Math.max(1,parseInt(document.getElementById('qty').value||'1',10)),title:${JSON.stringify(title(p))}+(o.text?' — '+o.text.split(' — ')[0]:''),price:Number(o.dataset.price),image:o.dataset.img||${JSON.stringify(images[0])}});
document.getElementById('added').hidden=false};`;
  return shopPage(
    title(p),
    `<div class="pdp">
<div class="gallery"><img id="main-img" src="${esc(images[0])}" alt="${esc(title(p))}">
<div class="thumbs">${images.slice(0, 8).map((i) => `<img src="${esc(i)}" alt="" loading="lazy">`).join("")}</div></div>
<div><h1>${esc(title(p))}</h1>
<p class="price"><span id="price">${fromPrice(p)} ر.س</span>${p.compareAtSar && p.compareAtSar.toNumber() > fromPrice(p) ? `<s class="was">${p.compareAtSar.toNumber()} ر.س</s>` : ""}</p>
<div class="shop-form">
${p.variants.length > 1 ? `<label>الخيار<select id="variant">${opts}</select></label>` : `<select id="variant" hidden>${opts}</select>`}
<label>الكمية<input id="qty" class="qty" type="number" min="1" max="20" value="1"></label>
<button class="btn primary" id="add" type="button">أضف للسلة</button>
<p id="added" class="alert" hidden>انضاف للسلة ✓ <a href="/shop/cart">روح للسلة</a></p>
</div>
${desc ? `<div class="card" style="margin-top:18px"><p>${esc(desc).replace(/\n/g, "<br>")}</p></div>` : ""}
<p class="note">الشحن لكل مدن السعودية خلال ${p.supplier === "manual" ? "٧–١٤ يوم" : "٧–١٥ يوم عمل تقريباً"}.</p>
</div></div>`,
    { description: (p.descriptionAr || title(p)).replace(/\s+/g, " ").slice(0, 155), script, image: images[0] },
  );
}

export function cartPageHtml(): string {
  const script = `
var box=document.getElementById('cart'),tot=document.getElementById('total'),form=document.getElementById('checkout'),err=document.getElementById('err');
function render(){var c=MUCart.get();if(!c.length){box.innerHTML='<p class="note">السلة فاضية. <a href="/shop">تسوّق الحين</a></p>';form.hidden=true;tot.textContent='0';return}
form.hidden=false;var s=0;box.innerHTML='';c.forEach(function(it,i){s+=it.price*it.quantity;var r=document.createElement('div');r.className='cart-row';
r.innerHTML='<img alt=""><div class="grow"><div class="t"></div><div class="note"></div></div><input class="qty" type="number" min="0" max="20"><button class="btn ghost" type="button">حذف</button>';
r.querySelector('img').src=it.image||'/assets/logo.jpg';r.querySelector('.t').textContent=it.title;r.querySelector('.note').textContent=it.price+' ر.س';
var q=r.querySelector('input');q.value=it.quantity;q.onchange=function(){var c2=MUCart.get();c2[i].quantity=Math.max(0,Math.min(20,parseInt(q.value||'0',10)));MUCart.set(c2.filter(function(x){return x.quantity>0}));render()};
r.querySelector('button').onclick=function(){var c2=MUCart.get();c2.splice(i,1);MUCart.set(c2);render()};box.appendChild(r)});tot.textContent=String(Math.round(s*100)/100)}
render();
form.onsubmit=async function(e){e.preventDefault();err.textContent='';var fd=new FormData(form),body={};fd.forEach(function(v,k){body[k]=v});
body.items=MUCart.get().map(function(x){return{variantId:x.variantId,quantity:x.quantity}});
var b=form.querySelector('button[type=submit]');b.disabled=true;
try{var r=await fetch('/api/shop/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});var j=await r.json();
if(!r.ok)throw new Error(j.error||'صار خطأ');MUCart.set([]);location.href='/shop/order/'+encodeURIComponent(j.number)+'?k='+encodeURIComponent(j.key)}catch(x){err.textContent=x.message;b.disabled=false}};`;
  return shopPage(
    "السلة",
    `<section class="sec narrow"><h1>السلة</h1><div id="cart"></div>
<p>المجموع: <b class="price"><span id="total">0</span> ر.س</b> <span class="note">(الشحن مشمول)</span></p>
<form id="checkout" class="shop-form" hidden>
<h2>بيانات التوصيل</h2>
<label>الاسم الكامل<input name="customerName" required minlength="3" autocomplete="name"></label>
<label>رقم الجوال<input name="phone" required inputmode="tel" placeholder="05xxxxxxxx" pattern="(\\+966|00966|0)?5[0-9]{8}" autocomplete="tel" dir="ltr"></label>
<label>المدينة<input name="city" required list="sa-cities" autocomplete="address-level2"></label>
<datalist id="sa-cities"><option>الرياض</option><option>جدة</option><option>مكة المكرمة</option><option>المدينة المنورة</option><option>الدمام</option><option>الخبر</option><option>الطائف</option><option>تبوك</option><option>بريدة</option><option>أبها</option><option>خميس مشيط</option><option>حائل</option><option>جازان</option><option>نجران</option><option>الأحساء</option><option>ينبع</option></datalist>
<label>الحي<input name="district"></label>
<label>العنوان (الشارع، رقم المبنى، العنوان الوطني المختصر)<input name="street" required autocomplete="street-address"></label>
<label>الرمز البريدي<input name="postalCode" inputmode="numeric" dir="ltr" autocomplete="postal-code"></label>
<label>ملاحظات<textarea name="notes" rows="2"></textarea></label>
<p class="note">طريقة الدفع: تحويل بنكي (تظهر لك بيانات الحساب بعد تأكيد الطلب).</p>
<p id="err" class="err"></p>
<button class="btn primary" type="submit">تأكيد الطلب</button>
</form></section>`,
    { script },
  );
}

const STATUS_AR: Record<string, string> = {
  PENDING_PAYMENT: "بانتظار التحويل",
  RECEIPT_UPLOADED: "تم رفع الإيصال — قيد المراجعة",
  PAID: "تم تأكيد الدفع",
  CJ_CREATED: "قيد التجهيز",
  CJ_FAILED: "قيد التجهيز",
  SHIPPED: "تم الشحن",
  DELIVERED: "تم التوصيل",
  CANCELLED: "ملغي",
};

export function orderPageHtml(order: Order & { items: OrderItem[] }, key: string): string {
  const total = order.totalSar.toNumber();
  const needsReceipt = order.status === "PENDING_PAYMENT" || order.status === "RECEIPT_UPLOADED";
  const script = needsReceipt
    ? `
document.getElementById('rc').onsubmit=async function(e){e.preventDefault();var f=document.getElementById('file').files[0],m=document.getElementById('rmsg');
if(!f){m.textContent='اختر صورة الإيصال';return}if(f.size>5*1024*1024){m.textContent='الحجم أكبر من 5MB';return}
m.textContent='جاري الرفع…';var r=await fetch('/api/shop/orders/${esc(order.number)}/receipt?k=${encodeURIComponent(key)}',{method:'POST',headers:{'content-type':f.type||'application/octet-stream'},body:f});
var j=await r.json().catch(function(){return{}});if(r.ok){location.reload()}else{m.textContent=j.error||'فشل الرفع'}};`
    : undefined;
  return shopPage(
    `الطلب ${order.number}`,
    `<section class="sec narrow"><h1>طلبك <span dir="ltr">${esc(order.number)}</span></h1>
<p class="alert">الحالة: <b>${esc(STATUS_AR[order.status] ?? order.status)}</b>${order.trackingNumber ? `<br>رقم التتبع: <b dir="ltr">${esc(order.trackingNumber)}</b>` : ""}${order.manualTracking ? `<br>تتبع الشحنة: ${/^https?:\/\//.test(order.manualTracking) ? `<a dir="ltr" href="${esc(order.manualTracking)}" target="_blank" rel="noopener">${esc(order.manualTracking)}</a>` : `<b dir="ltr">${esc(order.manualTracking)}</b>`}` : ""}</p>
<div class="card"><ul>${order.items.map((i) => `<li>${esc(i.title)} × ${i.quantity} — ${i.unitPriceSar.toNumber() * i.quantity} ر.س</li>`).join("")}</ul>
<p>المجموع: <b class="price">${total} ر.س</b></p>
<p class="note">التوصيل إلى: ${esc(order.customerName)} — ${esc(order.city)}${order.district ? `، ${esc(order.district)}` : ""}</p></div>
${
  needsReceipt
    ? `<div class="card">${bankTransfer.instructionsHtml({ number: order.number, totalSar: total })}
<form id="rc" class="shop-form"><label>صورة الإيصال<input id="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required></label>
<button class="btn primary" type="submit">${order.receiptUploadedAt ? "استبدال الإيصال" : "رفع الإيصال"}</button><p id="rmsg" class="note"></p></form></div>`
    : ""
}
<p class="note">احفظ رابط هالصفحة عشان تتابع طلبك. للاستفسار: <a href="https://wa.me/966557345682">واتساب</a></p></section>`,
    { script },
  );
}
