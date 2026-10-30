import { describe, expect, it } from "vitest";
import { extractFields, extractListedPrice, fingerprintFromVideo, missingListingFields } from "./extract";

describe("extractFields", () => {
  it("reads level and player id from free text", () => {
    const fields = extractFields("لفل 67 ايدي 5123456789 سكنات أسطورية", "فيس");
    expect(fields.level).toBe(67);
    expect(fields.playerId).toBe("5123456789");
    expect(fields.binding).toBe("فيس");
  });

  it("reads binding from free text", () => {
    expect(extractFields("حساب ربط جوجل").binding).toBe("جوجل");
  });
});

describe("extractListedPrice", () => {
  it("prefers the number next to the price, not the level", () => {
    expect(extractListedPrice("لفل 70 سعر 200 ريال")).toBe(200);
    expect(extractListedPrice("لفل 70")).toBeNull();
  });
});

describe("missingListingFields", () => {
  it("asks only for absent required fields", () => {
    expect(
      missingListingFields({ description: "لفل 70", price: 200, binding: "جوجل" }),
    ).toEqual([]);
    expect(missingListingFields({ description: "لفل 70", price: null, binding: "" })).toEqual([
      "price",
      "binding",
    ]);
  });
});

describe("fingerprintFromVideo", () => {
  it("prefixes the telegram unique id", () => {
    expect(fingerprintFromVideo("abc")).toBe("video:abc");
    expect(fingerprintFromVideo(null)).toBeNull();
  });
});
