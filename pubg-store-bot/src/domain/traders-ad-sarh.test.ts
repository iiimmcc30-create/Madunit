import { describe, expect, it } from "vitest";
import { rewriteTradersCaption } from "./traders-ad";
const ad = "لفل 80 مثك 77 سقوط B امفور الثلجي ماكس\nالسعر 1900";
describe("sarhstoree no installments", () => {
  it("does not add and strips installments for sarhstoree", () => {
    const out = rewriteTradersCaption(ad + "\nمتوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة", "iir8rr", { botUsername: "sarhstoree_bot" });
    expect(out).not.toMatch(/أقساط|اقساط/);
    expect(out).toContain("1900");
    expect(rewriteTradersCaption(ad, "iir8rr", { botUsername: "sarhstoree_bot" })).not.toMatch(/أقساط/);
  });
  it("DMSTOR still adds it", () => {
    expect(rewriteTradersCaption(ad, "x", { botUsername: "DMSTOR_bot" })).toMatch(/أقساط/);
  });
});
