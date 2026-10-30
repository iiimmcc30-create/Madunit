import { describe, expect, it } from "vitest";
import { rewriteTradersCaption, toSultanPriceStyle, setSultanPrice } from "./traders-ad";
import { parseTraderReduction } from "../bot/handlers/traders-mirror";

describe("Sultan price style", () => {
  it("القيمة/القيمه/السعر → بـ N", () => {
    expect(toSultanPriceStyle("الربط : ايميل رقم 7D الدولة متاح\nالقيمة: 3450")).toBe("الربط : ايميل رقم 7D الدولة متاح\nبـ 3450");
    expect(toSultanPriceStyle("x\nالقيمه : 3450")).toBe("x\nبـ 3450");
    expect(toSultanPriceStyle("x\nالسعر 3450 ريال")).toBe("x\nبـ 3450");
    expect(toSultanPriceStyle("الدولة متاح . السعر: 3450")).toBe("الدولة متاح . بـ 3450");
    expect(toSultanPriceStyle("x . بـ 3450\nالسعر 9")).toBe("x . بـ 3450\nالسعر 9");
  });
  it("rewrite: sultan converts, DMSTOR untouched", () => {
    const cap = "لفل 70 ثلجي\nالقيمة: 3450\n@trader_x";
    const su = rewriteTradersCaption(cap, "qw7w6", { botUsername: "Sultan_SL_Bot" });
    expect(su).toContain("بـ 3450");
    expect(su).not.toMatch(/القيمة/);
    expect(su.trim().endsWith("@qw7w6")).toBe(true);
    const dm = rewriteTradersCaption(cap, "o", { botUsername: "DMSTOR_bot" });
    expect(dm).toContain("القيمة: 3450");
  });
  it("setSultanPrice", () => {
    expect(setSultanPrice("لفل 70 . بـ 3450\n\n@qw7w6", 1000)).toBe("لفل 70 . بـ 1000\n\n@qw7w6");
    expect(setSultanPrice("لفل 70\n\n@qw7w6", 1000)).toBe("لفل 70\nبـ 1000\n\n@qw7w6");
  });
});

describe("trader reduction parse", () => {
  it("matches", () => {
    for (const t of ["مخفض ب1000", "مخفض 1000", "تخفيض 1000", "نزلته 1000", "خفضته لـ 1000", "- 1000 📎", "مخفض ب١٠٠٠"]) expect(parseTraderReduction(t)).toBe(1000);
  });
  it("ignores", () => {
    for (const t of ["تم البيع", "كم السعر؟", "لفل 80 ثلجي بـ 1850", "مخفض"]) expect(parseTraderReduction(t)).toBeNull();
  });
});

import { setMirrorPrice } from "./traders-ad";
describe("DMSTOR mirror price update", () => {
  it("updates بـ / السعر / القيمة or appends", () => {
    expect(setMirrorPrice("لفل 80 , بـ 1850\n\n@o", 1000)).toBe("لفل 80 , بـ 1000\n\n@o");
    expect(setMirrorPrice("لفل 80\nالسعر: 1850\n\n@o", 1000)).toBe("لفل 80\nالسعر: 1000\n\n@o");
    expect(setMirrorPrice("لفل 80\nالقيمة : 1850", 1000)).toBe("لفل 80\nالقيمة : 1000");
    expect(setMirrorPrice("لفل 80\n\n@o", 1000)).toBe("لفل 80\nبـ 1000\n\n@o");
  });
});
