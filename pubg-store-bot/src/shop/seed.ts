/**
 * Seeds the shop with researched CJ products (data/cj-seed-products.json) as DRAFT (unpublished).
 * Needs DATABASE_URL and CJ_API_KEY. Re-runnable: upserts by CJ pid and never changes status of existing products.
 *   node dist/shop/seed.js   (or: npx tsx src/shop/seed.ts)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
import { ShopService } from "./service";

interface SeedRow {
  cjPid: string;
  group: string;
  titleAr: string;
  shippingUsd: number;
  markupPercent: number;
}

async function main() {
  const db = new PrismaClient();
  const shop = new ShopService(db, {
    cjApiKey: process.env.CJ_API_KEY ?? "",
    usdToSar: Number(process.env.SHOP_USD_TO_SAR || 3.75),
    defaultMarkupPercent: Number(process.env.SHOP_DEFAULT_MARKUP_PERCENT || 120),
    defaultLogistic: process.env.CJ_DEFAULT_LOGISTIC || "CJPacket Liquid Line",
    cjPayType: 3,
    tokenCacheFile: process.env.CJ_TOKEN_CACHE_FILE || undefined,
  });
  const file = process.env.SHOP_SEED_FILE || join(process.cwd(), "data", "cj-seed-products.json");
  const rows = (JSON.parse(readFileSync(file, "utf8")) as { products: SeedRow[] }).products;
  for (const row of rows) {
    try {
      const detail = await shop.cj().productDetail(row.cjPid);
      const p = await shop.upsertFromDetail(detail, row.markupPercent, { titleAr: row.titleAr, shippingUsd: row.shippingUsd });
      console.log(`✓ [${row.group}] ${row.cjPid} → ${p.priceSar.toString()} SAR (${p.variants.length} variants, ${p.status})`);
    } catch (error) {
      console.error(`✗ ${row.cjPid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
