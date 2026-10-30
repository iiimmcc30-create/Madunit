import { describe, expect, it } from "vitest";
import { extractChannelAd, looksLikeChannelAd } from "./channel-ad";

const SAMPLE = `حساب ببجي
لفل 70
ربط قوقل
سعر 450 ريال
رقم الإعلان: F1442
التواصل للشراء: @i3xx22`;

describe("channel ad extract", () => {
  it("parses letter code + price from caption", () => {
    const out = extractChannelAd({
      caption: SAMPLE,
      video: { file_id: "vid1" },
    });
    expect(out.shortCode).toBe("F1442");
    expect(out.identity).toBe("F1442");
    expect(out.price).toBe(450);
    expect(out.media?.kind).toBe("video");
    expect(out.looksLikeAd).toBe(true);
    expect(out.looksSold).toBe(false);
  });

  it("parses hash identity", () => {
    const out = extractChannelAd({
      caption: "#6930\nلفل 84\nسعر 2900",
      photo: [{ file_id: "p1" }],
    });
    expect(out.identity).toBe("#6930");
    expect(out.shortCode).toBeNull();
    expect(out.price).toBe(2900);
    expect(out.looksLikeAd).toBe(true);
  });

  it("detects sold caption", () => {
    const out = extractChannelAd({
      caption: "F1442\n✅ تم البيع",
      photo: [{ file_id: "p1" }],
    });
    expect(out.looksSold).toBe(true);
    expect(out.shortCode).toBe("F1442");
  });

  it("rejects plain greetings without media", () => {
    expect(looksLikeChannelAd("السلام عليكم", false)).toBe(false);
    expect(extractChannelAd({ text: "السلام عليكم" }).looksLikeAd).toBe(false);
  });
});
