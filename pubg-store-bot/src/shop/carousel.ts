/** Lightweight 3-product promo carousel (scroll-snap + tiny JS). Shared by /shop and the static landing page. */
export const PROMO_SLIDES = [
  { href: "/shop/p/memo-cx08-pro", img: "/uploads/shop/memo-1.jpg", title: "مبرد جوال MEMO CX08 Pro", sub: "تبريد فوري يخلّي جوالك بارد طول القيم" },
  { href: "/shop/p/ipad-cooler-fs01", img: "/uploads/shop/fs01-1.jpg", title: "مبرد آيباد بمروحتين FS01", sub: "مروحتين قوية للآيباد والتابلت" },
  { href: "/shop/p/pubg-finger-sleeves-pro", img: "/uploads/shop/sleeve-3.jpg", title: "أصابع ببجي احترافية", sub: "تحكم أنعم وبدون تعرّق" },
];

export const CAROUSEL_CSS = `.mu-car{position:relative;margin:18px 0 8px}
.mu-car .eyebrow{margin:0 0 10px;text-align:center}
.mu-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none}
.mu-track::-webkit-scrollbar{display:none}
.mu-slide{flex:0 0 100%;scroll-snap-align:start;display:flex;flex-direction:column;align-items:center;gap:10px;color:inherit;text-decoration:none}
.mu-slide img{display:block;width:100%;max-width:520px;height:auto;aspect-ratio:1/1;object-fit:contain;border-radius:18px;border:1px solid rgba(90,160,255,.25)}
.mu-slide .cap{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.mu-slide h3{margin:0;font-size:clamp(17px,2.4vw,22px)}.mu-slide p{margin:0;opacity:.8}
.mu-slide .go{margin-top:4px;background:linear-gradient(90deg,#1d4ed8,#3b82f6);color:#fff;border-radius:99px;padding:9px 22px;font-weight:800}
.mu-dots{display:flex;gap:8px;justify-content:center;margin-top:12px}
.mu-dots button{width:9px;height:9px;border-radius:99px;border:0;background:#475569;padding:0;cursor:pointer}
.mu-dots button[aria-current=true]{background:#3b82f6;width:24px}`;

export const CAROUSEL_JS = `(function(){var c=document.querySelector('.mu-car');if(!c)return;var t=c.querySelector('.mu-track'),s=t.children,d=c.querySelector('.mu-dots'),i=0,tm;
for(var k=0;k<s.length;k++){(function(k){var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','شريحة '+(k+1));b.onclick=function(){go(k);rs()};d.appendChild(b)})(k)}
function mark(){for(var k=0;k<d.children.length;k++)d.children[k].setAttribute('aria-current',k===i?'true':'false')}
function go(k){i=(k+s.length)%s.length;t.scrollTo({left:s[i].offsetLeft-t.offsetLeft});mark()}
function rs(){clearInterval(tm);tm=setInterval(function(){go(i+1)},4000)}
var st;t.addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(function(){var w=t.clientWidth||1;var n=Math.round(Math.abs(t.scrollLeft)/w);if(n!==i){i=n;mark()}},80)},{passive:true});
t.addEventListener('touchstart',function(){clearInterval(tm)},{passive:true});t.addEventListener('touchend',rs,{passive:true});
mark();rs()})();`;

export function carouselHtml(): string {
  return `<section class="mu-car" aria-label="منتجات مختارة"><p class="eyebrow">متجر ملحقات وإكسسوارات ألعاب الجوال</p>
<div class="mu-track" dir="rtl">${PROMO_SLIDES.map(
    (s) => `<a class="mu-slide" href="${s.href}"><img src="${s.img}" alt="${s.title}" loading="lazy" width="1080" height="1080"><span class="cap"><h3>${s.title}</h3><p>${s.sub}</p><span class="go">تسوّق الآن</span></span></a>`,
  ).join("")}</div><div class="mu-dots"></div></section>`;
}
