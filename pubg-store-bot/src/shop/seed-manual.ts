/**
 * Upserts the manually-fulfilled products (supplier="manual"; never sent to CJ). Re-runnable.
 *   node dist/shop/seed-manual.js
 */
import { Prisma, PrismaClient } from "@prisma/client";
import "dotenv/config";

const IMG = "/uploads/shop/";
const PRODUCTS = [
  {
    key: "fs01",
    slug: "ipad-cooler-fs01",
    titleEn: "FS01 Dual-Fan iPad / Tablet Cooler",
    titleAr: "مبرد آيباد بمروحتين FS01",
    descriptionAr:
      "مبرد احترافي للآيباد والتابلت بمروحتين قويتين، يسحب الحرارة من ظهر الجهاز ويحافظ على أداء ثابت بدون تعليق أو نزول فريمات في الجيمات الطويلة.\n• مروحتين لتبريد أسرع وأوسع\n• تثبيت قوي ومناسب لأغلب مقاسات الآيباد والتابلت\n• تشغيل هادئ وخفيف الوزن\n• يشتغل بكيبل USB\nالفئة: مراوح / مبردات",
    priceSar: 81,
    compareAtSar: 109,
    images: ["fs01-1.jpg", "fs01-2.jpg"],
  },
  {
    key: "sleeve",
    slug: "pubg-finger-sleeves-pro",
    titleEn: "Pro Gaming Finger Sleeves",
    titleAr: "أصابع ببجي احترافية",
    descriptionAr:
      "أصابع ألعاب احترافية لببجي وكل ألعاب الجوال، قماش ناعم وحساس يخلي سحبك وتصويبك أسلس وأدق.\n• تمنع التعرّق والتزحلق على الشاشة\n• استجابة لمس عالية بدون تأخير\n• مريحة ومرنة وتناسب كل المقاسات\n• تقدر تغسلها وتستخدمها أكثر من مرة",
    priceSar: 29,
    compareAtSar: 45,
    images: ["sleeve-1.jpg", "sleeve-2.jpg", "sleeve-3.jpg"],
  },
  {
    key: "memo",
    slug: "memo-cx08-pro",
    titleEn: "MEMO CX08 Pro Phone Cooler",
    titleAr: "مبرد جوال MEMO CX08 Pro",
    descriptionAr:
      "مبرد الجوال MEMO CX08 Pro بتقنية التبريد السريع (Peltier) يبرد جوالك خلال ثواني ويخليه بارد طول القيم، عشان تلعب بأعلى إعدادات بدون حرارة ولا تعليق.\n• تبريد فوري وقوي\n• شاشة رقمية تعرض الحرارة\n• إضاءة RGB\n• مشبك قابل للتعديل يناسب أغلب الجوالات\n• تشغيل هادئ",
    priceSar: 117,
    compareAtSar: 149,
    images: ["memo-1.jpg", "memo-2.jpg", "memo-3.jpg"],
  },
];

async function main() {
  const db = new PrismaClient();
  for (const p of PRODUCTS) {
    const data = {
      slug: p.slug,
      titleEn: p.titleEn,
      titleAr: p.titleAr,
      descriptionAr: p.descriptionAr,
      images: p.images.map((i) => IMG + i),
      costUsd: new Prisma.Decimal(0),
      markupPercent: new Prisma.Decimal(0),
      priceSar: new Prisma.Decimal(p.priceSar),
      compareAtSar: new Prisma.Decimal(p.compareAtSar),
      supplier: "manual",
      featured: true,
      status: "PUBLISHED" as const,
    };
    const prod = await db.product.upsert({ where: { cjPid: `manual-${p.key}` }, create: { cjPid: `manual-${p.key}`, ...data }, update: data });
    await db.productVariant.upsert({
      where: { cjVid: `manual-${p.key}-1` },
      create: { productId: prod.id, cjVid: `manual-${p.key}-1`, sku: `MU-${p.key.toUpperCase()}`, name: "", costUsd: new Prisma.Decimal(0), priceSar: new Prisma.Decimal(p.priceSar) },
      update: { priceSar: new Prisma.Decimal(p.priceSar), active: true },
    });
    console.log(`ok /shop/p/${p.slug}`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
