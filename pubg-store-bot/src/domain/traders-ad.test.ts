import { describe, expect, it } from "vitest";
import {
  detectAd,
  isSultanBot,
  isTradersMirrorBot,
  isTradersGroupAdminNotice,
  hasUsableTradersCaption,
  rewriteTradersCaption,
  TRADERS_INSTALLMENTS_LINE,
} from "./traders-ad";

const SAMPLE_AD = `لفل 70
ربط قوقل
سكنات نادرة + امفور
سعر 450

جديد
#1Madness`;

describe("isTradersMirrorBot", () => {
  it("gates DMSTOR_bot, sarhstoree_bot, and sultan_sl_bot", () => {
    expect(isTradersMirrorBot("DMSTOR_bot")).toBe(true);
    expect(isTradersMirrorBot("@DMSTOR_bot")).toBe(true);
    expect(isTradersMirrorBot("sarhstoree_bot")).toBe(true);
    expect(isTradersMirrorBot("@sarhstoree_bot")).toBe(true);
    expect(isTradersMirrorBot("sultan_sl_bot")).toBe(true);
    expect(isTradersMirrorBot("@Sultan_SL_Bot")).toBe(true);
    expect(isTradersMirrorBot("sarhstoree")).toBe(false);
    expect(isTradersMirrorBot("Aramstoree")).toBe(false);
    expect(isTradersMirrorBot("madunitai")).toBe(false);
  });
});

describe("isSultanBot", () => {
  it("matches sultan_sl_bot only", () => {
    expect(isSultanBot("sultan_sl_bot")).toBe(true);
    expect(isSultanBot("@Sultan_SL_Bot")).toBe(true);
    expect(isSultanBot("dmstor_bot")).toBe(false);
    expect(isSultanBot("sarhstoree_bot")).toBe(false);
  });
});

describe("detectAd", () => {
  it("(a) sample ad with video caption+سعر+جديد+#tag → true", () => {
    expect(
      detectAd({ hasPhoto: false, hasVideo: true, caption: SAMPLE_AD }),
    ).toBe(true);
  });

  it("(b) «السلام عليكم» text-only → false", () => {
    expect(
      detectAd({ hasPhoto: false, hasVideo: false, caption: "السلام عليكم" }),
    ).toBe(false);
  });

  it("(c) video with short caption still mirrors (ads-only group)", () => {
    expect(
      detectAd({ hasPhoto: false, hasVideo: true, caption: "هههه تمام" }),
    ).toBe(true);
  });

  it("(d) photo+full listing body → true", () => {
    const body = `حساب ببجي لفل 65
ربط فيس
كونكر ميثك
سعر 320 ريال`;
    expect(detectAd({ hasPhoto: true, hasVideo: false, caption: body })).toBe(true);
  });

  it("ignores text-only even with listing body", () => {
    expect(
      detectAd({ hasPhoto: false, hasVideo: false, caption: SAMPLE_AD }),
    ).toBe(false);
  });

  it("mirrors photo with only جديد + hashtag (rewrite cleans it)", () => {
    expect(
      detectAd({ hasPhoto: true, hasVideo: false, caption: "جديد\n#1Madness" }),
    ).toBe(true);
  });

  it("mirrors media group flag", () => {
    expect(
      detectAd({ hasPhoto: false, hasVideo: false, hasMediaGroup: true, caption: "x" }),
    ).toBe(true);
  });
});

describe("rewriteTradersCaption", () => {
  const body = (o: string) => o.replace(/\n*@\w+\s*$/, "").trim();
  it("strips تصوير price / تصميم / صممت واجهه / جديد الدولة junk", () => {
    for (const bot of ["dmstor_bot", "sarhstoree_bot", "Sultan_SL_Bot"]) {
      const o1 = rewriteTradersCaption("لفل 80\nبـ: 1550\n\n1450 تصوير\n@i3xx22", "owner1", { botUsername: bot });
      expect(body(o1).endsWith("بـ: 1550")).toBe(true);
      expect(o1).not.toMatch(/i3xx22|تصوير/);
      expect(o1.endsWith("@owner1")).toBe(true);
      const o1b = rewriteTradersCaption("لفل 80\nبـ 1550\nتصوير 1450", "owner1", { botUsername: bot });
      expect(body(o1b).endsWith("بـ 1550")).toBe(true);
      expect(body(rewriteTradersCaption("لفل 70\nبـ 1250\n\nتصميم - ربطه معي ومع", "owner1", { botUsername: bot })).endsWith("بـ 1250")).toBe(true);
      expect(body(rewriteTradersCaption("لفل 70\nبـ 2900\n\nصممت واجهه - ربطه معي ومع", "owner1", { botUsername: bot })).endsWith("بـ 2900")).toBe(true);
      expect(body(rewriteTradersCaption("لفل 70\nبـ1990.\n\n- جديد، الدولة 46 يوم ✅", "owner1", { botUsername: bot })).endsWith("بـ1990.")).toBe(true);
      const keep = rewriteTradersCaption("لفل 70\nالدولة والسيرفر: متاح التغيير\nالدولة متاحة\nبـ 900", "owner1", { botUsername: bot });
      expect(keep).toMatch(/الدولة والسيرفر: متاح التغيير/);
      expect(keep).toMatch(/الدولة متاحة/);
    }
  });




  it("strips safi net number under price", () => {
    const ad = `لفل 78
فيس بنت
الربط ايميل ورقم 6d
بـ 590
540
@trader_x`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/بـ 590|590/);
    expect(out).not.toMatch(/(^|\n)540(\n|$)/);
    expect(out).not.toMatch(/صافي/);

    const ad2 = `لفل 70
بـ: 1000
صافي 800
@x`;
    const out2 = rewriteTradersCaption(ad2, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out2).toMatch(/1000/);
    expect(out2).not.toMatch(/صافي|800/);

    // Real DMSTOR style: قيمه inline + bare net under it
    const ad3 = `متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة
لڤل 78 ، فيس البنت و القصات
الربط : إيميل و رقم 6d ، القيمه : 590

540

@someone
@i3xx22`;
    const out3 = rewriteTradersCaption(ad3, "i3xx22", { botUsername: "DMSTOR_bot" });
    expect(out3).toMatch(/590/);
    expect(out3).not.toMatch(/(^|\n)540(\n|$)/);
    expect(out3).toMatch(/@i3xx22/);
  });

  it("strips faida and renew chatter", () => {
    const ad = `لفل 80
بـ 2000
اللي وده ينزله محتاج بيعته جددوه تصوير جديد واجهه جديده
طاري الفايده
ناشب
طول مره`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/لفل 80/);
    expect(out).toMatch(/بـ 2000/);
    expect(out).not.toMatch(/الفايده|فايدة|محتاج بيعته|تصوير جديد|واجهه|ناشب|طول مره/i);
  });

  it("strips trader meta lines (cancelled / reduced / renew)", () => {
    const ad = `لفل 76
فيس بنت
بـ 1950
- خفضت جددوه لاهنتو
@trader_x`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/لفل 76/);
    expect(out).toMatch(/بـ 1950/);
    expect(out).not.toMatch(/خفضت/);
    expect(out).not.toMatch(/جددوه/);
    expect(out).not.toMatch(/لاهنتو/);

    const ad2 = `لفل 85
بـ 5500
- تكنسلت بيعته اللي وده يرجع ينزله
@trader_y`;
    const out2 = rewriteTradersCaption(ad2, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out2).toMatch(/لفل 85/);
    expect(out2).toMatch(/بـ 5500/);
    expect(out2).not.toMatch(/تكنسلت/);
    expect(out2).not.toMatch(/ينزله/);

    const ad3 = `لفل 70
السعر مخفض
بـ 900`;
    const out3 = rewriteTradersCaption(ad3, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out3).not.toMatch(/مخفض/);
    expect(out3).toMatch(/بـ 900/);
    expect(out3).toMatch(/لفل 70/);
  });

  it("strips price-edit chatter عدلت سعره and non-owner trader @", () => {
    const ad = `متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة
لفل 87
260 ميثك
33 قولد
الربط : تويتر ، ايميل ، رقم - القيمه : 6750
عدلت سعره
@trader_xyz`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/لفل 87/);
    expect(out).toMatch(/6750/);
    expect(out).toMatch(/الربط/);
    expect(out).toMatch(/متوفر أقساط/);
    expect(out).not.toMatch(/عدلت/);
    expect(out).not.toMatch(/@trader_xyz/i);
    expect(out).toMatch(/@i3xx22/);

    const ad2 = `لفل 70
بـ 900
عدلت السعر
@foo_bar`;
    const out2 = rewriteTradersCaption(ad2, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out2).toMatch(/بـ 900/);
    expect(out2).not.toMatch(/عدلت/);
    expect(out2).not.toMatch(/@foo_bar/i);

    const ad3 = `لفل 70
بـ 800
عدّلت سعرها
@zzz_trader`;
    const out3 = rewriteTradersCaption(ad3, "iir8rr", { botUsername: "sarhstoree_bot" });
    expect(out3).toMatch(/بـ 800/);
    expect(out3).not.toMatch(/عد.?لت|سعرها/);
    expect(out3).not.toMatch(/@zzz_trader/i);
    expect(out3).toMatch(/@iir8rr/);
    // Owner handle only — if trader reused a different @i3xx22-like name it stays stripped
    const ad4 = `لفل 60
القيمه : 500
عدلت سعره
@i3xx22`;
    const out4 = rewriteTradersCaption(ad4, "iir8rr", { botUsername: "sarhstoree_bot" });
    expect(out4).not.toMatch(/عدلت/);
    expect(out4).not.toMatch(/@i3xx22/i);
    expect(out4).toMatch(/@iir8rr/);
  });

  it("strips design/price-raise chatter تصميم ورفعت سعره and leftover junk", () => {
    const ad = `متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة
لفل 80
ايطار Aviation
خودة ميثك لفل 3
بـ 1550
تصميم ورفعت سعره ي ومع -
@trader_xyz`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/لفل 80/);
    expect(out).toMatch(/1550/);
    expect(out).toMatch(/متوفر أقساط/);
    expect(out).toMatch(/@i3xx22/);
    expect(out).not.toMatch(/تصميم/);
    expect(out).not.toMatch(/رفعت/);
    expect(out).not.toMatch(/ي ومع/);
    expect(out).not.toMatch(/@trader_xyz/i);

    const ad2 = `لفل 70
بـ 900
رفعت السعر
@foo_bar`;
    const out2 = rewriteTradersCaption(ad2, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out2).toMatch(/بـ 900/);
    expect(out2).not.toMatch(/رفعت/);
    expect(out2).not.toMatch(/@foo_bar/i);

    const ad3 = `لفل 65
بـ 800
رفّعت سعرها
@zzz_trader`;
    const out3 = rewriteTradersCaption(ad3, "iir8rr", { botUsername: "sarhstoree_bot" });
    expect(out3).toMatch(/بـ 800/);
    expect(out3).not.toMatch(/رف.?عت|سعرها/);
    expect(out3).not.toMatch(/@zzz_trader/i);
    expect(out3).toMatch(/@iir8rr/);

    // سعر inside سعره must not keep the meta line as listing body
    const ad4 = `لفل 80
بـ 1550
تصميم ورفعت سعره
@trader_abc`;
    const out4 = rewriteTradersCaption(ad4, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out4).toMatch(/بـ 1550/);
    expect(out4).not.toMatch(/تصميم|رفعت/);
    expect(out4).toMatch(/@i3xx22/);
  });

  it("strips standalone trailing chatter that is not listing body", () => {
    const ad = `لفل 80
ربط قوقل
بـ 1200
يا جماعة حدّثو لو سمحتوا`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/لفل 80/);
    expect(out).toMatch(/بـ 1200/);
    expect(out).not.toMatch(/حدّثو|حدثو/);
    expect(out).not.toMatch(/يا جماعة/);
  });

  it("does not wipe ad body via phone regex across newlines", () => {
    const ad = `لفل 83
المجموعة 66
المثك 115
ايطار RE2
كونكر S16
الربط : ايميل ورقم
بـ: 1450
@trader_x`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/لفل 83/);
    expect(out).toMatch(/المثك 115/);
    expect(out).toMatch(/بـ: 1450/);
    expect(out).toMatch(/ايطار RE2/);
    expect(out).not.toMatch(/@trader_x/);
  });

  it("keeps body as-is after strips and appends @owner", () => {
    const out = rewriteTradersCaption(SAMPLE_AD, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).not.toMatch(/جديد/);
    expect(out).not.toMatch(/#1Madness/i);
    expect(out).not.toMatch(/Madness/i);
    expect(out).toMatch(/@i3xx22/i);
    expect(out).toMatch(/لفل 70/);
    expect(out).toMatch(/سعر 450/);
    expect(out).toMatch(/ربط قوقل/);
    expect(out).not.toMatch(/تم الربط|غير مربوط|آيفون/i);
  });

  it("strips ALL @handles then appends owner once", () => {
    const out = rewriteTradersCaption(
      "لفل 50\nسعر 200\n@trader_x @other_guy @i3xx22",
      "i3xx22",
      { botUsername: "dmstor_bot" },
    );
    expect(out).not.toMatch(/@trader_x/i);
    expect(out).not.toMatch(/@other_guy/i);
    expect(out.match(/@i3xx22/gi)?.length).toBe(1);
    expect(out.trim().endsWith("@i3xx22")).toBe(true);
  });

  it("removes مكرر variant", () => {
    const out = rewriteTradersCaption("ربط قوقل\nسعر 100\nمكرر\n#foo", "i3xx22", {
      botUsername: "sarhstoree_bot",
    });
    expect(out).not.toMatch(/مكرر/);
    expect(out).not.toMatch(/#foo/);
    expect(out).toMatch(/@i3xx22/);
  });

  it("strips punctuated مكرر./-جديد- and trader «الربط مع …» junk", () => {
    const ad = `متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة
وصف حساب تجريبي
سعر 500
@trader_x
مكرر. الربط مع ايفورا`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/وصف حساب تجريبي/);
    expect(out).toMatch(/سعر 500/);
    expect(out).not.toMatch(/مكرر/);
    expect(out).not.toMatch(/ايفورا/);
    expect(out).not.toMatch(/الربط\s+مع/);
    expect(out).not.toMatch(/@trader_x/);
    expect(out).toMatch(/@i3xx22/);

    const ad2 = `حساب نادر
سعر 300
-الربط مع ايفورا - جديد-`;
    const out2 = rewriteTradersCaption(ad2, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out2).toMatch(/حساب نادر/);
    expect(out2).toMatch(/سعر 300/);
    expect(out2).not.toMatch(/مكرر|جديد|ايفورا|الربط\s+مع/);

    const ad3 = `وصف\nسعر 200\nمكرر. الربط مع\n@trader`;
    const out3 = rewriteTradersCaption(ad3, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out3).toMatch(/وصف/);
    expect(out3).toMatch(/سعر 200/);
    expect(out3).not.toMatch(/مكرر/);
    expect(out3).not.toMatch(/الربط\s+مع/);
  });

  it("keeps real account linking (تغير ايميل / ايميل ورقم / ربط قوقل)", () => {
    const ad = `لفل 70
ربط قوقل
الربط : ايميل ورقم
تغير ايميل
سعر 450
جديد
#tag
@trader_x`;
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/ربط قوقل/);
    expect(out).toMatch(/الربط\s*:\s*ايميل ورقم/);
    expect(out).toMatch(/تغير ايميل/);
    expect(out).toMatch(/سعر 450/);
    expect(out).not.toMatch(/جديد/);
    expect(out).not.toMatch(/#tag/);
    expect(out).not.toMatch(/@trader_x/);
    expect(out).toMatch(/@i3xx22/);
  });

  it("strips حساب ببجي title", () => {
    const out = rewriteTradersCaption(
      "<b>حساب ببجي</b>\nلفل 89\nسعر 880\n@trader_x",
      "i3xx22",
      { botUsername: "dmstor_bot" },
    );
    expect(out).not.toMatch(/حساب\s*ببجي/);
    expect(out).toMatch(/لفل 89/);
    expect(out).not.toMatch(/@trader_x/);
  });

  it("prepends installments only when missing — both bots", () => {
    const ad = "لفل 50\nسعر 200\nجديد\n@trader_x";
    const dm = rewriteTradersCaption(ad, "i3xx22", { botUsername: "@DMSTOR_bot" });
    expect(dm.startsWith(`${TRADERS_INSTALLMENTS_LINE}\n\n`)).toBe(true);
    expect(dm).not.toMatch(/@trader_x/);
    expect(dm).not.toMatch(/جديد/);

    const sr = rewriteTradersCaption(ad, "iir8rr", { botUsername: "sarhstoree_bot" });
    expect(sr).not.toMatch(/أقساط/);
    expect(sr).toMatch(/@iir8rr/);
  });

  it("passes price through unchanged and never invents سعر", () => {
    const ad = "لفل 89\nامفور الثلجي\nبـ: 880\n@trader_x";
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).toMatch(/بـ: 880/);
    expect(out).not.toMatch(/سعر\s*\d/); // no invented سعر line
    // original price digits preserved exactly once as written
    expect(out.match(/880/g)?.length).toBe(1);
  });

  it("does not duplicate installments when body already has اقساط", () => {
    const ad =
      "متوفر اقساط دفعه 4 و6 و8 و12\nM416 Glacier Max\nلفل 89\nسعر 880\n@trader_x";
    const dm = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    const sr = rewriteTradersCaption(ad, "iir8rr", { botUsername: "sarhstoree_bot" });
    expect(sr).not.toMatch(/اقساط|أقساط/);
    for (const out of [dm]) {
      const matches = out.match(/اقساط|أقساط/gi) ?? [];
      // original line kept; no second prepended line
      expect(matches.length).toBe(1);
      expect(out).toMatch(/متوفر اقساط دفعه 4 و6 و8 و12/);
      expect(out).not.toMatch(
        new RegExp(
          `${TRADERS_INSTALLMENTS_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n+\\s*متوفر`,
        ),
      );
      expect(out).toMatch(/M416 Glacier Max/);
      expect(out).toMatch(/لفل 89/);
      expect(out).not.toMatch(/@trader_x/);
    }
  });

  it("does not prepend when caption already has متوفر", () => {
    const ad = "متوفر تسليم فوري\nلفل 40\nسعر 100";
    const out = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(out).not.toContain(TRADERS_INSTALLMENTS_LINE);
    expect(out).toMatch(/متوفر تسليم فوري/);
  });

  it("DMSTOR strips رقم الإعلان / solo codes but keeps game tokens like M416", () => {
    const ad = `M416 Glacier Max
لفل 89
رقم الإعلان: A123
F1442
>9999
سعر 880
@trader_x`;
    const dm = rewriteTradersCaption(ad, "i3xx22", { botUsername: "dmstor_bot" });
    expect(dm).toMatch(/M416/);
    expect(dm).toMatch(/لفل 89/);
    expect(dm).toMatch(/سعر 880/);
    expect(dm).not.toMatch(/رقم\s*الإعلان/);
    expect(dm).not.toMatch(/A123/);
    expect(dm).not.toMatch(/F1442/);
    expect(dm).not.toMatch(/>9999/);
    expect(dm).not.toMatch(/@trader_x/);

    const sr = rewriteTradersCaption(ad, "iir8rr", { botUsername: "sarhstoree_bot" });
    // sarhstoree matches DMSTOR: same ad-number strip
    expect(sr).not.toMatch(/رقم\s*الإعلان/);
    expect(sr).not.toMatch(/F1442/);
    expect(sr).toMatch(/M416/);
  });

  it("strips استفسار inquiry lines", () => {
    const out = rewriteTradersCaption(
      "لفل 50\nسعر 200\nللاستفسار اضغط هنا\n@trader_x",
      "i3xx22",
      { botUsername: "dmstor_bot" },
    );
    expect(out).not.toMatch(/استفسار/);
  });

  it("empty caption still gets installments + owner for mirror bots", () => {
    const out = rewriteTradersCaption("", "i3xx22", { botUsername: "dmstor_bot" });
    expect(out.startsWith(TRADERS_INSTALLMENTS_LINE)).toBe(true);
    expect(out).toMatch(/@i3xx22/);
  });
});


describe("isTradersGroupAdminNotice", () => {
  it("detects صفى الحسابات المباعه variants", () => {
    expect(isTradersGroupAdminNotice("صفى الحسابات المباعه")).toBe(true);
    expect(isTradersGroupAdminNotice("صفّى الحسابات المباعة")).toBe(true);
    expect(isTradersGroupAdminNotice("صفيت الحسابات المباعة من القروب")).toBe(true);
    expect(isTradersGroupAdminNotice("مسحت الحسابات المباعه")).toBe(true);
    expect(isTradersGroupAdminNotice("نظفت الإعلانات المباعة")).toBe(true);
  });

  it("does not flag real listing captions", () => {
    expect(
      isTradersGroupAdminNotice(`لفل 70
ربط قوقل
سعر 450`),
    ).toBe(false);
    expect(isTradersGroupAdminNotice("تم البيع")).toBe(false);
    expect(isTradersGroupAdminNotice("حساب مباع؟")).toBe(false);
  });

  it("hasUsableTradersCaption rejects admin cleanup", () => {
    expect(hasUsableTradersCaption("صفى الحسابات المباعه", "i3xx22", "DMSTOR_bot")).toBe(
      false,
    );
  });
});
