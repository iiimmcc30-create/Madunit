import { describe, expect, it } from "vitest";
import { telegramHref } from "./brand";
import { renderLanding } from "./landing";

describe("landing page", () => {
  it("renders the hero and pricing in Arabic", () => {
    const html = renderLanding({
      publicUrl: "https://getsarh.tech",
      trialUrl: "https://t.me/demo_bot",
      contactUrl: "https://t.me/owner",
    });
    expect(html).toContain("سهران بوت");
    expect(html).toContain("وكيلك الذكي لقناتك");
    expect(html).toContain("جرّب يومين مجانًا");
    expect(html).toContain("99");
    expect(html).toContain("قريبًا: تنظيم السكرمات");
    expect(html).toContain("https://t.me/demo_bot");
    expect(html).toContain('og:image');
  });

  it("builds telegram links from @username or url", () => {
    expect(telegramHref("@Shop")).toBe("https://t.me/Shop");
    expect(telegramHref("https://t.me/Shop")).toBe("https://t.me/Shop");
  });
});
