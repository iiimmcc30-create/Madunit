import { describe, expect, it } from "vitest";
import { buildCoverCard } from "./model";
import { DEFAULT_COVER_THEME, parseCoverTheme } from "./theme";

describe("buildCoverCard", () => {
  it("shows level, skins, price and listing code from known facts only", () => {
    const card = buildCoverCard({
      shortCode: "A001",
      price: 250,
      extracted: { level: 70, skins: ["إيبك", "أسطوري", "نادر", "زيادة"] },
      theme: DEFAULT_COVER_THEME,
    });
    expect(card.shortCode).toBe("A001");
    expect(card.level).toBe("لفل 70");
    expect(card.priceLabel).toContain("250");
    expect(card.skins).toContain("إيبك");
    expect(card.skins).not.toContain("زيادة");
  });
});

describe("parseCoverTheme", () => {
  it("fills store-specific colors and keeps defaults", () => {
    expect(parseCoverTheme({ accent: "#00FF00" }).accent).toBe("#00FF00");
    expect(parseCoverTheme({}).title).toBe("حساب ببجي");
  });
});
