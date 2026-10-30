import { describe, expect, it } from "vitest";
import { containsSellerLeak, formatPublicListing, safeAgentReply, stripSellerLeak } from "./public-listing";

describe("خصوصية الإعلان العام", () => {
  it("ما يظهر البائع في صياغة الإعلان", () => {
    const text = formatPublicListing({
      shortCode: "A001",
      storeId: "s1",
      price: 450,
      description: "مثلية الثلجي",
      binding: "جوجل",
      level: 70,
      skins: ["مثالية الثلجي"],
      ownerUsername: "cv_91",
    });
    expect(text).toContain("A001");
    expect(text).not.toMatch(/seller/i);
  });

  it("يشيل يوزر غير المالك وأرقام الجوال", () => {
    const cleaned = stripSellerLeak("السعر 400 كلم @bad_seller أو 0551234567", "cv_91");
    expect(cleaned).not.toContain("bad_seller");
    expect(cleaned).not.toContain("0551234567");
    expect(containsSellerLeak("كلم @bad_seller", "cv_91")).toBeTruthy();
    expect(containsSellerLeak("تواصل مع @cv_91", "cv_91")).toBeNull();
  });

  it("يرفض رد فيه تسريب", () => {
    const reply = safeAgentReply("هذا رقم البائع telegramId: 999", "cv_91");
    expect(reply).toContain("المالك");
    expect(reply).not.toContain("999");
  });
});
