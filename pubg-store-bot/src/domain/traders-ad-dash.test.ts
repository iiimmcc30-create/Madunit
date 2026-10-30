import { describe, expect, it } from "vitest";
import { rewriteTradersCaption } from "./traders-ad";
const cap = "متوفر اقساط\nتربل ثلجي, لفل 80 ... الربط ايميل ورقم متاح للتغيير, بـ 1850\n\n- 1750 📎\n\n@i3xx22";
describe("trader dash price-drop line", () => {
  it("DMSTOR strips «- 1750 📎», keeps بـ 1850 + installments + owner only", () => {
    const out = rewriteTradersCaption(cap, "ownerx", { botUsername: "DMSTOR_bot" });
    expect(out).not.toMatch(/1750/);
    expect(out).toContain("بـ 1850");
    expect(out).toMatch(/اقساط/);
    expect(out).not.toMatch(/i3xx22/);
    expect(out.trim().endsWith("@ownerx")).toBe(true);
  });
  it("variants stripped, word lines kept, sarh too", () => {
    for (const l of ["-1750", "— 1750 📎", "- 1,750", "– ١٧٥٠ 📎"]) {
      const out = rewriteTradersCaption(`لفل 80 ثلجي بـ 1850\n${l}`, "o", { botUsername: "sarhstoree_bot" });
      expect(out).not.toMatch(/1750|١٧٥٠|1,750/);
    }
    const keep = rewriteTradersCaption("لفل 80\n- 2 كونكر\n- سعر 1750", "o", { botUsername: "DMSTOR_bot" });
    expect(keep).toContain("- 2 كونكر");
  });
});
