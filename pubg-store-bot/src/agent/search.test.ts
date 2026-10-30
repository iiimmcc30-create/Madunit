import { describe, expect, it } from "vitest";
import { loadGlobalGlossary } from "../domain/glossary";
import { formatSearchReply, parseSearchFilters, rankListings, type SearchableListing } from "./search";

const glossary = loadGlobalGlossary();

const catalog: SearchableListing[] = [
  {
    shortCode: "A001",
    storeId: "s1",
    price: 450,
    description: "لفل 70 مثالية الثلجي M416 ربط جوجل",
    ownerUsername: "cv_91",
    extractedFields: { level: 70, skins: ["مثالية الثلجي"], binding: "جوجل" },
  },
  {
    shortCode: "A002",
    storeId: "s1",
    price: 620,
    description: "مثالية الثلجي ماكس",
    ownerUsername: "cv_91",
    extractedFields: { skins: ["مثالية الثلجي"] },
  },
  {
    shortCode: "A003",
    storeId: "s1",
    price: 180,
    description: "حساب لفل 40 بدون سكنات نادرة",
    ownerUsername: "cv_91",
    extractedFields: { level: 40 },
  },
  {
    shortCode: "A004",
    storeId: "s1",
    price: 390,
    description: "X-Suit وكونكر مربوط فيس",
    ownerUsername: "cv_91",
    extractedFields: { skins: ["X-Suit"], binding: "فيس" },
  },
];

describe("rankListings", () => {
  it("يقترح أنسب المعروض لطلب ثلجي بأقل من 500", () => {
    const filters = parseSearchFilters("عندكم حساب فيه مثالية الثلجي بأقل من 500؟", glossary);
    expect(filters.maxPrice).toBe(500);
    expect(filters.skins?.some((skin) => skin.includes("ثلجي"))).toBe(true);

    const hits = rankListings(catalog, filters, glossary);
    expect(hits.map((hit) => hit.shortCode)).toEqual(["A001"]);
    expect(hits[0]?.price).toBeLessThan(500);
    const reply = formatSearchReply(hits);
    expect(reply).toContain("A001");
    expect(reply).not.toContain("seller");
    expect(reply).toContain("المالك");
  });
});
