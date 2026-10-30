import { describe, expect, it, vi } from "vitest";
import { isBareSellIntent, looksLikeBuyerListingLookup, looksLikeSellIntent } from "../../agent/heuristic";
import { registerIntentHandlers, SELL_PROMPT, FALLBACK_PROMPT } from "./intent";

function setup(agentText = "هلا، حيّاك.") {
  let handler: any;
  const bot: any = { callbackQuery: () => undefined, on: (_: string, h: any) => (handler = h) };
  const agentReply = vi.fn(async () => ({ text: agentText }));
  const deps: any = {
    botUsername: "sarhstoree_bot",
    storeId: "s1",
    db: { store: { findUnique: async () => ({ id: "s1", channelId: "-100", ownerUsername: "iir8rr" }) } },
    logger: { info() {}, warn() {}, error() {} },
    agent: { reply: agentReply },
    downloadTelegramFile: async () => null,
    llm: {},
  };
  registerIntentHandlers(bot, deps);
  const run = async (message: any) => {
    const replies: string[] = [];
    const ctx: any = {
      chat: { type: "private", id: 555 },
      from: { id: 555 },
      message,
      session: {},
      conversation: { active: () => 0 },
      reply: async (t: string) => replies.push(t),
    };
    const next = vi.fn();
    await handler(ctx, next);
    return { replies, next, agentReply };
  };
  return run;
}

describe("seller intent heuristics", () => {
  it("bare seller phrases", () => {
    for (const t of ["يعلن عندك", "ابي اعلن", "ابي انشر اعلان", "أبي أعلن"]) {
      expect(looksLikeSellIntent(t)).toBe(true);
      expect(isBareSellIntent(t)).toBe(true);
      expect(looksLikeBuyerListingLookup(t)).toBe(false);
    }
    for (const t of ["موجود؟", "انباع؟", "تحقق", "موجود ولا انباع"]) {
      expect(isBareSellIntent(t)).toBe(false);
      expect(looksLikeBuyerListingLookup(t)).toBe(true);
    }
  });
});

describe("non-owner private message on sarhstoree", () => {
  it("greeting goes to MAD AI and gets a reply", async () => {
    const r = await setup()({ message_id: 1, text: "سلام" });
    expect(r.agentReply).toHaveBeenCalled();
    expect(r.replies).toEqual(["هلا، حيّاك."]);
  });
  it("seller intent asks for media/desc/price", async () => {
    const r = await setup()({ message_id: 1, text: "يعلن عندك" });
    expect(r.replies).toEqual([SELL_PROMPT]);
  });
  it("media without caption falls through to agent (not swallowed)", async () => {
    const r = await setup("أرسل الوصف والسعر")({ message_id: 1, video: { file_id: "v", file_unique_id: "u" } });
    expect(r.agentReply).toHaveBeenCalled();
    expect(r.replies.length).toBe(1);
  });
  it("sticker still gets a reply", async () => {
    const r = await setup()({ message_id: 1, sticker: { file_id: "x" } });
    expect(r.replies).toEqual([FALLBACK_PROMPT]);
  });
});

import { hasRealDescription, realDescriptionOrUndefined } from "../../agent/heuristic";
import { classifyPrivateSellerAd } from "./private-direct-publish";
describe("empty ad guard", () => {
  it("placeholder text is not a description", () => {
    for (const t of ["فيديو", "صورة", "حساب ببجي", "متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة\n\nفيديو\n\n@iir8rr", "السعر 1900"]) {
      expect(hasRealDescription(t)).toBe(false);
      expect(realDescriptionOrUndefined(t)).toBeUndefined();
    }
  });
  it("real description passes", () => {
    const d = "لفل 80 المثك .77 . السقوط B . تيشيرت الصحراء . امفور الثلجي ماكس . الربط بريد فقط\nالسعر : 1900";
    expect(hasRealDescription(d)).toBe(true);
  });
  it("direct publish refuses video + فيديو caption", () => {
    const base = { hasMedia: true, forwarded: false, ownerUsername: "iir8rr", botUsername: "sarhstoree_bot" };
    expect(classifyPrivateSellerAd({ ...base, caption: "فيديو" }).publish).toBe(false);
    expect(classifyPrivateSellerAd({ ...base, caption: "متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة فيديو" }).publish).toBe(false);
  });
  it("seller description with open draft goes to agent (not lookup)", async () => {
    let handler: any;
    const bot: any = { callbackQuery: () => undefined, on: (_: string, h: any) => (handler = h) };
    const reply = vi.fn(async () => ({ text: "عدّلت المسودة." }));
    const deps: any = {
      botUsername: "sarhstoree_bot", storeId: "s1",
      db: { store: { findUnique: async () => ({ id: "s1", channelId: "-100", ownerUsername: "iir8rr" }) } },
      logger: { info() {}, warn() {}, error() {} },
      agent: { reply, memory: { getDraft: async () => ({ videoFileId: "v", price: 1900 }) } },
      downloadTelegramFile: async () => null, llm: {},
    };
    registerIntentHandlers(bot, deps);
    const text = "لفل 80 المثك .77 . السقوط B . تيشيرت الصحراء . امفور الثلجي ماكس . الباقي موضح في الفديو . الربط بريد فقط\nالسعر : 1900 وقابل للتفاوض";
    const ctx: any = { chat: { type: "private" }, from: { id: 9 }, message: { message_id: 1, text }, session: {}, conversation: { active: () => 0 }, reply: async () => undefined };
    await handler(ctx, vi.fn());
    expect((reply.mock.calls[0] as any)[0].text).toBe(text);
  });
});

import { planHeuristic, looksLikeAvailabilityAsk } from "../../agent/heuristic";
describe("seller description regression 19:32", () => {
  const desc = "لفل 80 المثك 77. السقوط B . تيشرت الصحراء . فيس البنت معا كل القصات . المختبر 29 أهمها . امفور الثلجي ماكس . امفور المومياء ماكس . امفور الرحالة كيل مسج . ايكي الضوء الايقاعي كيل مسج . ايكي التنين كيل مسج . الباقي موضح في الفديو . الربط بريد فقط\nالسعر : 1900";
  const ctx: any = { glossary: [], focusShortCode: "A001", role: "seller", hasDraft: true, lastSearchCodes: [] };
  it("is not an availability ask", () => {
    expect(looksLikeAvailabilityAsk(desc)).toBe(false);
    expect(looksLikeAvailabilityAsk(desc.replace("السعر", "القيمه"))).toBe(false);
  });
  it("updates draft with description + price, never inquire A001", () => {
    for (const d of [desc, desc.replace("السعر", "القيمه")]) {
      const plan: any = planHeuristic(d, ctx);
      expect(plan.kind).toBe("update_draft");
      expect(plan.price).toBe(1900);
    }
    expect(planHeuristic(desc, { ...ctx, role: "super_admin" } as any).kind).toBe("update_draft");
  });
  it("still treats real asks as lookup", () => {
    expect(looksLikeAvailabilityAsk("موجود؟")).toBe(true);
    expect(looksLikeAvailabilityAsk("A001 باقي؟")).toBe(true);
  });
});
describe("intent phrases are not descriptions", () => {
  it("ابي انشر اعلان", () => {
    expect(hasRealDescription("ابي انشر اعلان")).toBe(false);
    expect(hasRealDescription("ابي انشر مسوده الاعلان")).toBe(false);
  });
});
