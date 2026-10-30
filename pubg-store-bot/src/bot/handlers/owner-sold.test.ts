import { describe, expect, it, vi } from "vitest";
import { isOwnerSoldIntent, registerOwnerSoldHandlers, SOLD_REPLY_TEXT } from "./owner-sold";

describe("owner sold intent", () => {
  it("matches", () => {
    for (const t of ["اشطب الاعلان", "اشطب", "تم البيع", "انباع", "علم عليه مباع", "اشطب عالاعلان"]) expect(isOwnerSoldIntent(t)).toBe(true);
    for (const t of ["موجود ولا انباع؟", "انباع؟", "لفل 80 تم البيع الاسبوع الماضي وارجع", "ابي انشر اعلان"]) expect(isOwnerSoldIntent(t)).toBe(false);
  });
});

function setup(ownerId = "1") {
  const handlers: any = {};
  const bot: any = { callbackQuery: (k: string, h: any) => (handlers[k] = h), on: (_: string, h: any) => (handlers.msg = h) };
  const kv: Record<string, string> = {};
  const redis = { get: async (k: string) => kv[k] ?? null, set: async (k: string, v: string) => { kv[k] = v; }, del: async (k: string) => { delete kv[k]; } };
  const update = vi.fn(async () => ({}));
  const deps: any = {
    botUsername: "sarhstoree_bot", storeId: "s1", redis, config: { superAdminTelegramId: "999" },
    logger: { info() {}, warn() {} },
    db: {
      store: { findUnique: async () => ({ id: "s1", channelId: "-1002640903520", ownerTelegramId: ownerId, ownerUsername: "iir8rr" }) },
      listing: { findFirst: async (q: any) => (q.where.channelMessageId === 19894 || q.where.shortCode === "A010" || q.where.telegramVideoUniqueId === "UQ" ? { id: "L", status: "PUBLISHED", channelMessageId: 19894, telegramVideoFileId: "v", store: {} } : null), update },
    },
  };
  registerOwnerSoldHandlers(bot, deps);
  const api = { editMessageCaption: vi.fn(async () => true), editMessageText: vi.fn(async () => true), sendMessage: vi.fn(async () => ({})) };
  const send = async (from: number, message: any) => {
    const replies: string[] = [];
    const next = vi.fn();
    await handlers.msg({ chat: { type: "private" }, from: { id: from }, message, api, reply: async (t: string) => replies.push(t) }, next);
    return { replies, next };
  };
  return { send, api, update };
}
const fwd = { forward_origin: { type: "channel", chat: { id: -1002640903520 }, message_id: 19894 }, video: {}, caption: "لفل 74\nالقيمة: 2300\n\n@iir8rr" };

describe("owner sold flow", () => {
  it("intent → ask forward → forward strikes + reply + SOLD", async () => {
    const { send, api, update } = setup();
    expect((await send(1, { text: "اشطب الاعلان" })).replies).toEqual(["حوّل لي الإعلان من القناة 👇"]);
    const r = await send(1, fwd);
    expect(r.replies).toEqual(["تم ✅"]);
    expect((api.editMessageCaption.mock.calls[0] as any)[2].caption).toMatch(/^<s>لفل 74[\s\S]*@iir8rr<\/s>$/);
    expect(api.sendMessage).toHaveBeenCalledWith("-1002640903520", SOLD_REPLY_TEXT, expect.objectContaining({ reply_parameters: expect.objectContaining({ message_id: 19894 }) }));
    expect(update).toHaveBeenCalledWith({ where: { id: "L" }, data: { status: "SOLD" } });
  });
  it("intent then ad number", async () => {
    const { send, api } = setup();
    await send(1, { text: "تم البيع" });
    expect((await send(1, { text: "A010" })).replies).toEqual(["تم ✅"]);
    expect(api.sendMessage).toHaveBeenCalled();
  });
  it("old post not in DB, text post → editMessageText fallback", async () => {
    const { send, api } = setup();
    api.editMessageCaption.mockRejectedValueOnce({ description: "there is no caption in the message to edit" });
    await send(1, { text: "اشطب" });
    await send(1, { forward_origin: { type: "channel", chat: { id: -1002640903520 }, message_id: 500 }, text: "حساب قديم 900" });
    expect(api.editMessageText).toHaveBeenCalled();
  });
  it("non-owner never triggers", async () => {
    const { send, api } = setup();
    const r = await send(7, { text: "اشطب الاعلان" });
    expect(r.next).toHaveBeenCalled();
    await send(7, fwd);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
  it("forward hidden origin (from bot user) matched by video unique id", async () => {
    const { send, api } = setup();
    await send(1, { text: "اشطب" });
    const r = await send(1, { forward_origin: { type: "user", sender_user: { id: 42 } }, forward_date: 1, video: { file_unique_id: "UQ" }, caption: "لفل 80 المثك 77" });
    expect(r.replies).toEqual(["تم ✅"]);
    expect((api.editMessageCaption.mock.calls[0] as any)[1]).toBe(19894);
  });
  it("strike removes old «تم البيع ✅» header", async () => {
    const { strikeFullCaption } = await import("./owner-sold");
    expect(strikeFullCaption("تم البيع ✅\n\nلفل 80\n@iir8rr")).toBe("<s>لفل 80\n@iir8rr</s>");
  });
  it("owner forward without pending → asks with button", async () => {
    const { send, api } = setup();
    const r = await send(1, fwd);
    expect(r.replies).toEqual(["تبي أشطبه كمباع؟"]);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
