import { describe, expect, it } from "vitest";
import {
  describeSetupInput,
  extractForwardedChatId,
  formatMissingPermissions,
  messageLink,
  isChannelAdministrator,
  isHiddenChannelForward,
  missingChannelAdminPermissions,
  parseChannelId,
  parseChannelLink,
  parseChannelRef,
  parseSetupChannelInput,
} from "./channel";

describe("parseChannelId", () => {
  it("accepts a numeric channel id with or without the minus", () => {
    expect(parseChannelId("-1001234567890")).toBe("-1001234567890");
    expect(parseChannelId("1001234567890")).toBe("-1001234567890");
    expect(parseChannelId("channel id: -1001234567890")).toBe("-1001234567890");
    expect(parseChannelId("@shop")).toBeNull();
  });

  it("reads a private t.me/c link as a channel id", () => {
    expect(parseChannelId("https://t.me/c/1234567890/12")).toBe("-1001234567890");
  });
});

describe("parseChannelRef", () => {
  it("accepts @username, bare username, and t.me links", () => {
    expect(parseChannelRef("@My_Shop")).toEqual({ kind: "username", value: "My_Shop" });
    expect(parseChannelRef("https://t.me/My_Shop/44")).toEqual({ kind: "username", value: "My_Shop" });
    expect(parseChannelLink("t.me/joinchat/AAAA")).toBeNull();
  });
});

describe("forwarded channel extraction", () => {
  it("reads Bot API channel origin and legacy forward_from_chat", () => {
    expect(
      extractForwardedChatId({
        forward_origin: { type: "channel", chat: { id: -1001 } },
      }),
    ).toBe("-1001");
    expect(
      extractForwardedChatId({
        forward_from_chat: { id: -1002, type: "channel" },
      }),
    ).toBe("-1002");
  });

  it("reads origin type chat via sender_chat", () => {
    expect(
      extractForwardedChatId({
        forward_origin: { type: "chat", sender_chat: { id: -1003, type: "channel" } },
      }),
    ).toBe("-1003");
  });

  it("flags hidden forwards without channel data", () => {
    expect(
      isHiddenChannelForward({
        forward_origin: { type: "hidden_user" },
        forward_date: 1,
      }),
    ).toBe(true);
    expect(isHiddenChannelForward({ forward_date: 1, forward_sender_name: "Channel" })).toBe(true);
    expect(
      isHiddenChannelForward({
        forward_origin: { type: "channel", chat: { id: -1001 } },
      }),
    ).toBe(false);
  });
});

describe("parseSetupChannelInput", () => {
  it("accepts a shared chat from the request-chat button", () => {
    expect(
      parseSetupChannelInput({
        message: { chat_shared: { request_id: 7101, chat_id: -1009 } },
      }),
    ).toEqual({ kind: "chat_shared", value: "-1009" });
  });

  it("accepts a username text and a forwarded channel post", () => {
    expect(parseSetupChannelInput({ message: { text: "@shop_channel" } })).toEqual({
      kind: "username",
      value: "shop_channel",
    });
    expect(
      parseSetupChannelInput({
        message: { forward_origin: { type: "channel", chat: { id: -1008 } } },
      }),
    ).toEqual({ kind: "forward", value: "-1008" });
  });

  it("returns hidden_forward when Telegram strips the source", () => {
    expect(
      parseSetupChannelInput({
        message: { text: "منشور", forward_date: 99, forward_origin: { type: "hidden_user" } },
      }),
    ).toEqual({ kind: "hidden_forward" });
  });

  it("logs a safe shape for diagnostics without copying secrets", () => {
    const log = describeSetupInput({
      message: {
        text: "123456:AAHidemeTokenValueForTests",
        forward_origin: { type: "hidden_user" },
      },
    });
    expect(log.forwardOriginType).toBe("hidden_user");
    expect(log.textShape).toBe("redacted-token");
    expect(JSON.stringify(log)).not.toContain("AAHideme");
  });
});

describe("channel admin rights", () => {
  it("requires the bot to be a posting admin", () => {
    expect(isChannelAdministrator("creator")).toBe(true);
    expect(isChannelAdministrator("administrator", true)).toBe(true);
    expect(isChannelAdministrator("administrator", false)).toBe(false);
    expect(isChannelAdministrator("member", true)).toBe(false);
  });

  it("names the exact missing permission", () => {
    expect(
      missingChannelAdminPermissions({ chatType: "channel", status: "member" }),
    ).toEqual(["أدمن", "نشر الرسائل"]);
    expect(
      missingChannelAdminPermissions({
        chatType: "channel",
        status: "administrator",
        canPostMessages: false,
      }),
    ).toEqual(["نشر الرسائل"]);
    expect(
      formatMissingPermissions(["نشر الرسائل"]),
    ).toContain("نشر الرسائل");
  });
});

describe("group targets", () => {
  it("accepts forwards from a supergroup as a bind target", () => {
    expect(
      parseSetupChannelInput({
        message: { forward_origin: { type: "chat", sender_chat: { id: -1001, type: "supergroup" } } } as never,
      }),
    ).toEqual({ kind: "forward", value: "-1001" });
    expect(
      parseSetupChannelInput({ message: { forward_from_chat: { id: -1002, type: "supergroup" } } as never }),
    ).toEqual({ kind: "forward", value: "-1002" });
  });
  it("still accepts channel forwards and group usernames/links", () => {
    expect(
      parseSetupChannelInput({
        message: { forward_origin: { type: "channel", chat: { id: -1003, type: "channel" } } } as never,
      }),
    ).toEqual({ kind: "forward", value: "-1003" });
    expect(parseSetupChannelInput({ message: { text: "@mygroup" } as never }).kind).toBe("username");
    expect(parseSetupChannelInput({ message: { text: "https://t.me/mygroup" } as never }).kind).not.toBe("unknown");
  });
  it("checks group permissions without channel-only can_post_messages", () => {
    expect(missingChannelAdminPermissions({ chatType: "supergroup", status: "administrator" })).toEqual([]);
    expect(
      missingChannelAdminPermissions({ chatType: "supergroup", status: "administrator", canDeleteMessages: false }),
    ).toEqual(["حذف الرسائل"]);
    expect(missingChannelAdminPermissions({ chatType: "group", status: "member" })).toEqual(["أدمن", "حذف الرسائل"]);
    expect(missingChannelAdminPermissions({ chatType: "channel", status: "administrator" })).toEqual(["نشر الرسائل"]);
    expect(formatMissingPermissions(["حذف الرسائل"], "supergroup")).toContain("المجموعة");
  });
  it("builds t.me message links for public and private chats", () => {
    expect(messageLink("-1001234567890", 42)).toBe("https://t.me/c/1234567890/42");
    expect(messageLink("-1001234567890", 42, "@mystore")).toBe("https://t.me/mystore/42");
    expect(messageLink("-4567", 1)).toBeNull();
  });
});
