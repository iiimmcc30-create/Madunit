import { describe, expect, it } from "vitest";
import { hasContactHints, sanitizeListingText, unexpectedMentions } from "./sanitize";

describe("sanitizeListingText", () => {
  it("strips seller usernames, phones, and telegram links", () => {
    const raw =
      "لفل 70 كلموني @seller_x على t.me/seller_x وواتس wa.me/966501234567 رقم 0501234567";
    const clean = sanitizeListingText(raw);
    expect(clean).not.toMatch(/@seller/i);
    expect(clean).not.toMatch(/t\.me/i);
    expect(clean).not.toMatch(/wa\.me/i);
    expect(clean).not.toMatch(/0501234567/);
    expect(clean).toMatch(/لفل 70/);
  });
});

describe("hasContactHints", () => {
  it("flags seller contact attempts", () => {
    expect(hasContactHints("كلموني @seller_x")).toBe(true);
    expect(hasContactHints("لفل 70 سكن إيبك")).toBe(false);
  });
});

describe("unexpectedMentions", () => {
  it("allows only the owner username", () => {
    expect(unexpectedMentions("تواصل @shop_owner", "shop_owner")).toEqual([]);
    expect(unexpectedMentions("تواصل @shop_owner و @hacker", "shop_owner")).toEqual([
      "hacker",
    ]);
  });
});
