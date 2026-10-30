import { describe, expect, it, vi } from "vitest";
import { parsePriceDrop, priceDropCaption, tryPriceDrop } from "./price-drop";

describe("parsePriceDrop", () => {
  it("seller drop phrases", () => {
    for (const t of ["خفض السعر 1600", "نزل السعر الى 1600", "نزلته 1600", "السعر صار 1600", "خفض A005 1600", "١٦٠٠ خفضته"]) {
      expect(parsePriceDrop(t)).toBe(1600);
    }
  });
  it("not buyer questions or publishing", () => {
    for (const t of ["بكم السعر؟", "كم آخر سعر 1600؟", "نزل السعر؟", "ابي انزل اعلان", "نزل حساب 1600", "خفض السعر", "موجود؟", "ابي انشر اعلان"]) {
      expect(parsePriceDrop(t)).toBeNull();
    }
  });
  it("caption has no installments", () => {
    const c = priceDropCaption(1600, "iir8rr");
    expect(c).toBe("تم التخفيض 🔻");
    expect(c).not.toMatch(/أقساط/);
  });
});

function ctxFor(text: string, reply?: string) {
  const sent: any[] = [];
  const replies: string[] = [];
  return {
    sent, replies,
    ctx: {
      chat: { type: "private" }, from: { id: 5 },
      message: { text, reply_to_message: reply ? { text: reply } : undefined },
      api: { sendMessage: async (...a: any[]) => sent.push(a) },
      reply: async (t: string) => replies.push(t),
    } as any,
  };
}
function depsFor(listings: any[]) {
  const update = vi.fn(async () => ({}));
  return {
    update,
    deps: {
      botUsername: "sarhstoree_bot", storeId: "s1", logger: { info() {} },
      db: {
        seller: { findUnique: async () => ({ id: "sel" }) },
        store: { findUnique: async () => ({ id: "s1", channelId: "-1002640903520", ownerUsername: "iir8rr" }) },
        listing: { findMany: async () => listings, update },
      },
    } as any,
  };
}

describe("tryPriceDrop", () => {
  it("single ad → reply in channel + db update", async () => {
    const { ctx, sent, replies } = ctxFor("خفض السعر 1600");
    const { deps, update } = depsFor([{ id: "L1", shortCode: "A005", channelMessageId: 19900, price: 1900, createdAt: new Date() }]);
    expect(await tryPriceDrop(ctx, deps)).toBe(true);
    expect(sent[0][0]).toBe("-1002640903520");
    expect(sent[0][2].reply_parameters.message_id).toBe(19900);
    expect(update).toHaveBeenCalledWith({ where: { id: "L1" }, data: { price: 1600 } });
    expect(replies[0]).toContain("تم التخفيض ونزلته بالقناة ✅");
  });
  it("several ads + ambiguous → asks which", async () => {
    const { ctx, sent, replies } = ctxFor("نزلته 1600");
    const { deps } = depsFor([{ id: "a", shortCode: "A007", channelMessageId: 2, price: 1900 }, { id: "b", shortCode: "A005", channelMessageId: 1, price: 1900 }]);
    expect(await tryPriceDrop(ctx, deps)).toBe(true);
    expect(sent.length).toBe(0);
    expect(replies[0]).toContain("A007");
  });
  it("reply to publish confirmation picks that ad", async () => {
    const { ctx, sent } = ctxFor("نزلته 1600", "تم النشر في القناة ✅\nرقم الإعلان: A005");
    const { deps } = depsFor([{ id: "a", shortCode: "A007", channelMessageId: 2, price: 1900 }, { id: "b", shortCode: "A005", channelMessageId: 1, price: 1900 }]);
    await tryPriceDrop(ctx, deps);
    expect(sent[0][2].reply_parameters.message_id).toBe(1);
  });
  it("no ads → not handled (falls to agent)", async () => {
    const { ctx } = ctxFor("خفض السعر 1600");
    expect(await tryPriceDrop(ctx, depsFor([]).deps)).toBe(false);
  });
  it("other bots ignored", async () => {
    const { ctx } = ctxFor("خفض السعر 1600");
    const d = depsFor([{ id: "a", shortCode: "A1", channelMessageId: 1 }]).deps;
    d.botUsername = "DMSTOR_bot";
    expect(await tryPriceDrop(ctx, d)).toBe(false);
  });
});

import { ensurePriceLine } from "../../services/listing";
import { rewriteTradersCaption } from "../../domain/traders-ad";
import { parsePriceEdit } from "./price-drop";
describe("price edit 19:50 regression", () => {
  const cap = "لفل 74 • مثك 42 • اطار طيار فضي ... الباقي موضح بالفيديو\nالقيمة: 2300\nالربط : تويتر إيميل رقم";
  it("القيمة/القيمه/السعر kept and replaced", () => {
    const body = rewriteTradersCaption(cap, "iir8rr", { botUsername: "sarhstoree_bot" });
    expect(body).toContain("القيمة: 2300");
    expect(body).not.toMatch(/أقساط/);
    expect(ensurePriceLine(body, 2400, "iir8rr")).toContain("القيمة: 2400");
    expect(ensurePriceLine("x\nالقيمه:2300\n\n@iir8rr", 2000, "iir8rr")).toContain("القيمه:2000");
    expect(ensurePriceLine("x\nالسعر : 2300", 2000, "")).toContain("السعر : 2000");
  });
  it("adds price line when missing", () => {
    expect(ensurePriceLine("لفل 80 الباقي بالفيديو\n\n@iir8rr", 2300, "iir8rr")).toBe("لفل 80 الباقي بالفيديو\nالسعر: 2300 ريال\n\n@iir8rr");
  });
  it("parses edit phrases", () => {
    expect(parsePriceEdit("2400")).toEqual({ price: 2400, kind: "bare" });
    expect(parsePriceEdit("عدل السعر خليه 2400")).toEqual({ price: 2400, kind: "set" });
    expect(parsePriceEdit("غير السعر 2400")?.price).toBe(2400);
    expect(parsePriceEdit("خفض السعر 1600")?.kind).toBe("drop");
    expect(parsePriceEdit("بكم؟")).toBeNull();
  });
  it("bare 2400 right after publish raises silently (no channel post)", async () => {
    const { ctx, sent, replies } = ctxFor("2400");
    const { deps, update } = depsFor([{ id: "L1", shortCode: "A010", channelMessageId: 19894, price: 2300, createdAt: new Date() }]);
    deps.db.inquiry = { findFirst: async () => null };
    expect(await tryPriceDrop(ctx, deps)).toBe(true);
    expect(sent.length).toBe(0);
    expect(update).toHaveBeenCalledWith({ where: { id: "L1" }, data: { price: 2400 } });
    expect(replies[0]).toContain("A010");
  });
  it("pending edit then bare A010 applies", async () => {
    const store: Record<string, string> = {};
    const redis = { get: async (k: string) => store[k] ?? null, set: async (k: string, v: string) => { store[k] = v; }, del: async (k: string) => { delete store[k]; } };
    const ads = [{ id: "a", shortCode: "A010", channelMessageId: 2, price: 2300 }, { id: "b", shortCode: "A009", channelMessageId: 1, price: 1900 }];
    const d1 = depsFor(ads); d1.deps.redis = redis;
    const c1 = ctxFor("عدل السعر خليه 2400");
    await tryPriceDrop(c1.ctx, d1.deps);
    expect(c1.replies[0]).toContain("أرسل رقم الإعلان");
    const c2 = ctxFor("A010");
    expect(await tryPriceDrop(c2.ctx, d1.deps)).toBe(true);
    expect(d1.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { price: 2400 } });
  });
  it("bare number with open draft → agent handles", async () => {
    const { ctx } = ctxFor("2300");
    const { deps } = depsFor([{ id: "L1", shortCode: "A010", channelMessageId: 1, price: 2300, createdAt: new Date() }]);
    deps.agent = { memory: { getDraft: async () => ({ videoFileId: "v" }) } };
    expect(await tryPriceDrop(ctx, deps)).toBe(false);
  });
});
