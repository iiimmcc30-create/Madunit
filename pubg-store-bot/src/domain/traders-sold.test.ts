import { describe, expect, it } from "vitest";
import {
  cleanSoldReferenceText,
  detectTradersSold,
  formatChannelSoldCaption,
  formatChannelSoldNotice,
  formatChannelSoldReply,
  formatChannelSoldThankYou,
  formatStruckSoldCaption,
  hasHeavyStrikethrough,
  hasSoldPhrase,
} from "./traders-sold";

describe("traders sold detection", () => {
  it("detects Arabic تم البيع with checkmark", () => {
    expect(hasSoldPhrase("✅ تم البيع")).toBe(true);
    expect(detectTradersSold("~~#6822 لفل 71~~\n✅ تم البيع")).toBe(true);
  });

  it("detects مباع / sold", () => {
    expect(detectTradersSold("الحساب مباع")).toBe(true);
    expect(detectTradersSold("SOLD F1442")).toBe(true);
  });

  it("detects strikethrough + identity without phrase", () => {
    expect(hasHeavyStrikethrough("~~#6822 لفل 71~~")).toBe(true);
    expect(detectTradersSold("~~#6822 لفل 71~~")).toBe(true);
    expect(detectTradersSold("<s>F1442 حساب</s>")).toBe(true);
  });

  it("detects Telegram MessageEntity strikethrough (no markers in plain text)", () => {
    const text = "#6822 لفل 71 سعر 2900";
    const entities = [{ type: "strikethrough", offset: 0, length: text.length }];
    expect(hasHeavyStrikethrough(text, entities)).toBe(true);
    expect(hasHeavyStrikethrough(text)).toBe(false);
    expect(detectTradersSold(text, entities)).toBe(true);
    expect(detectTradersSold(text)).toBe(false);
  });

  it("ignores spoiler entities (not strikethrough)", () => {
    const text = "#6822 لفل 71";
    const entities = [{ type: "spoiler", offset: 0, length: text.length }];
    expect(hasHeavyStrikethrough(text, entities)).toBe(false);
    expect(detectTradersSold(text, entities)).toBe(false);
  });

  it("ignores tiny strikethrough spans", () => {
    const text = "#6822 لفل 71";
    const entities = [{ type: "strikethrough", offset: 0, length: 1 }];
    expect(hasHeavyStrikethrough(text, entities)).toBe(false);
  });

  it("ignores plain listing without sold cues", () => {
    expect(detectTradersSold("#6930\nلفل 84\nسعر 2900")).toBe(false);
    expect(detectTradersSold("السلام عليكم")).toBe(false);
  });

  it("formats channel notice", () => {
    const out = formatChannelSoldNotice("#6822 لفل 71، ايطار طايره فضي");
    expect(out).toContain("<s>");
    expect(out).toContain("تم البيع ✅");
    expect(out).toContain("#6822");
    expect(out).toMatch(/<\/s>\nتم البيع ✅$/);
  });

  it("formats struck caption with تم البيع ✅ footer (same post, not thank-you)", () => {
    const struck = formatStruckSoldCaption("لفل 71\nسعر 2900");
    expect(struck).toMatch(/^<s>/);
    expect(struck).toContain("لفل 71");
    expect(struck).toMatch(/<\/s>\nتم البيع ✅$/);
    // Footer must be outside strikethrough
    expect(struck).not.toMatch(/تم البيع ✅<\/s>/);
    const channel = formatChannelSoldCaption("لفل 71");
    expect(channel).toContain("<s>");
    expect(channel).toContain("تم البيع ✅");
    expect(channel).toMatch(/<\/s>\nتم البيع ✅$/);
    // Thank-you helper still exists for legacy callers but sold path must not use it
    const thanks = formatChannelSoldThankYou("S017");
    expect(thanks).toContain("✅ تم البيع");
    expect(thanks).toContain("شكر");
    expect(thanks).toContain("S017");
    expect(formatChannelSoldReply()).toContain("شكر");
  });

  it("sold caption matches screenshot style on full listing", () => {
    const listing = `متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة
لفل 76 | فيس البنت والقصات
الربط : ايميل - القيمة : 440
390 ✅✅

@i3xx22`;
    const out = formatChannelSoldCaption(listing);
    expect(out.startsWith("<s>")).toBe(true);
    expect(out.endsWith("تم البيع ✅")).toBe(true);
    expect(out).toContain("لفل 76");
    expect(out).toContain("@i3xx22");
    const close = out.indexOf("</s>");
    const footerAt = out.indexOf("تم البيع ✅");
    expect(close).toBeGreaterThan(0);
    expect(footerAt).toBeGreaterThan(close);
  });

  it("does not double-escape already-escaped captions", () => {
    const struck = formatStruckSoldCaption("A &amp; B", { alreadyEscaped: true });
    expect(struck).toContain("A &amp; B");
    expect(struck).not.toContain("&amp;amp;");
    expect(
      formatChannelSoldCaption("A &amp; B", null, { alreadyEscaped: true }),
    ).toContain("A &amp; B");
  });

  it("cleans strike markers", () => {
    expect(cleanSoldReferenceText("~~#6822 لفل 71~~\n✅ تم البيع")).toMatch(/^#6822/);
  });
});
