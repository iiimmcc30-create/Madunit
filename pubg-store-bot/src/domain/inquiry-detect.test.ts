import { describe, expect, it } from "vitest";
import {
  detectInquiryCode,
  inquiryJobDelays,
  isForwardedMessage,
  parseForwardedChannel,
} from "./inquiry-detect";

describe("detectInquiryCode", () => {
  it("reads codes from buyer questions", () => {
    expect(detectInquiryCode("A123 موجود؟")).toBe("A123");
    expect(detectInquiryCode("موجود a7")).toBe("A007");
    expect(detectInquiryCode("رقم الإعلان: A001")).toBe("A001");
    expect(detectInquiryCode("هل الحساب متوفر")).toBeNull();
  });
});

describe("parseForwardedChannel", () => {
  it("reads Bot API channel origin", () => {
    expect(
      parseForwardedChannel({
        forward_origin: { type: "channel", chat: { id: -1001 }, message_id: 77 },
      }),
    ).toEqual({ channelId: "-1001", messageId: 77 });
  });

  it("reads legacy forward fields", () => {
    expect(
      parseForwardedChannel({
        forward_from_chat: { id: -1001 },
        forward_from_message_id: 42,
      }),
    ).toEqual({ channelId: "-1001", messageId: 42 });
  });
});

describe("isForwardedMessage", () => {
  it("detects forwards so they are not treated as new listings", () => {
    expect(isForwardedMessage({ forward_date: 1 })).toBe(true);
    expect(isForwardedMessage({})).toBe(false);
  });
});

describe("inquiryJobDelays", () => {
  it("schedules reminder then a grace timeout", () => {
    expect(inquiryJobDelays(15, 5)).toEqual({
      reminderMs: 15 * 60_000,
      timeoutMs: 20 * 60_000,
    });
  });
});
