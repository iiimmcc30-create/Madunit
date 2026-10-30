import { describe, expect, it } from "vitest";
import {
  assertOwnerOnlyMentions,
  DEFAULT_LISTING_TEMPLATE,
  formatListingCaption,
  normalizeListingTemplate,
} from "./caption";

const base = {
  shortCode: "A123",
  description: "لفل 70 سكن إيبك، أسلحة مطورة",
  price: 250,
  binding: "جوجل",
  ownerUsername: "shop_owner",
};

describe("formatListingCaption", () => {
  it("includes listing fields and owner only", () => {
    const caption = formatListingCaption(base);
    expect(caption).toContain("A123");
    expect(caption).toContain("250");
    expect(caption).toContain("جوجل");
    expect(caption).toContain("@shop_owner");
    expect(caption).toContain("التسليم والشراء عبر المالك فقط");
    expect(caption).not.toContain("تم البيع");
    assertOwnerOnlyMentions(caption, "shop_owner");
  });

  it("strips seller contact from the description", () => {
    const caption = formatListingCaption({
      ...base,
      description: "حساب قوي تواصل @hidden_seller و 0555555555",
    });
    expect(caption).not.toContain("hidden_seller");
    expect(caption).not.toContain("0555555555");
    expect(caption).toContain("@shop_owner");
    assertOwnerOnlyMentions(caption, "shop_owner");
  });

  it("marks sold listings", () => {
    const caption = formatListingCaption({ ...base, sold: true });
    expect(caption.startsWith("تم البيع ✅")).toBe(true);
  });

  it("escapes html from seller text", () => {
    const caption = formatListingCaption({
      ...base,
      description: "<script>alert(1)</script> لفل 10",
    });
    expect(caption).toContain("&lt;script&gt;");
    expect(caption).not.toContain("<script>");
  });

  it("uses a custom store template", () => {
    const caption = formatListingCaption(base, "رقم {shortCode} سعر {price}");
    expect(caption).toBe("رقم A123 سعر 250");
    expect(DEFAULT_LISTING_TEMPLATE).toContain("{ownerUsername}");
  });

  it("default template has no decorative publish emojis", () => {
    for (const emoji of ["💰", "🔗", "🏷", "📞", "⚠️", "⚠"]) {
      expect(DEFAULT_LISTING_TEMPLATE).not.toContain(emoji);
    }
    expect(DEFAULT_LISTING_TEMPLATE).toContain("السعر:");
    expect(DEFAULT_LISTING_TEMPLATE).toContain("الربط:");
  });

  it("normalizes old emoji default template", () => {
    const old = `<b>حساب ببجي</b>

{description}

💰 السعر: {price} ريال
🔗 الربط: {binding}
🏷 رقم الإعلان: <b>{shortCode}</b>

📞 التواصل للشراء: @{ownerUsername}
⚠️ التسليم والشراء عبر المالك فقط — لا تتعامل مع أي شخص ثاني`;
    expect(normalizeListingTemplate(old)).toBe(DEFAULT_LISTING_TEMPLATE);
    const caption = formatListingCaption(base, old);
    expect(caption).not.toContain("💰");
    expect(caption).not.toContain("🔗");
  });
});
