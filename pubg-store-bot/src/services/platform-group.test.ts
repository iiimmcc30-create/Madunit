import { describe, expect, it } from "vitest";
import { assertBotIsChannelAdmin, migratedChatId } from "./platform";

function fakeApi(chat: { type: string; title?: string }, members: Record<number, Record<string, unknown>>) {
  return {
    getMe: async () => ({ id: 1 }),
    getChat: async () => ({ id: -100, ...chat }),
    getChatMember: async (_: string, id: number) => {
      const m = members[id];
      if (!m) throw new Error("user not found");
      return m;
    },
  } as never;
}

describe("assertBotIsChannelAdmin with groups", () => {
  it("binds a supergroup when bot and actor are admins", async () => {
    const api = fakeApi({ type: "supergroup", title: "G" }, {
      1: { status: "administrator", can_delete_messages: true },
      7: { status: "creator" },
    });
    await expect(assertBotIsChannelAdmin(api, "-100", { actorTelegramId: "7" })).resolves.toEqual({ chatType: "supergroup", title: "G" });
  });
  it("rejects when the person binding is not a group admin", async () => {
    const api = fakeApi({ type: "supergroup" }, { 1: { status: "administrator" }, 7: { status: "member" } });
    await expect(assertBotIsChannelAdmin(api, "-100", { actorTelegramId: "7" })).rejects.toMatchObject({ code: "ACTOR_NOT_ADMIN" });
  });
  it("rejects a group where the bot cannot delete messages", async () => {
    const api = fakeApi({ type: "supergroup" }, { 1: { status: "administrator", can_delete_messages: false } });
    await expect(assertBotIsChannelAdmin(api, "-100")).rejects.toMatchObject({ code: "BOT_NOT_ADMIN" });
  });
  it("keeps can_post_messages for channels", async () => {
    const api = fakeApi({ type: "channel" }, { 1: { status: "administrator", can_post_messages: false } });
    await expect(assertBotIsChannelAdmin(api, "-100")).rejects.toMatchObject({ code: "BOT_NOT_ADMIN" });
  });
  it("reads migrate_to_chat_id from Telegram errors", () => {
    expect(migratedChatId({ parameters: { migrate_to_chat_id: -100999 } })).toBe("-100999");
    expect(migratedChatId(new Error("x"))).toBeNull();
  });
});
