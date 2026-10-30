import { describe, expect, it } from "vitest";
import {
  displayLeader,
  isClearWord,
  parseDropsLink,
  parseGroupChatId,
  parseGroupReviewReply,
  teamIdFromReviewMarkup,
  withDropsLink,
} from "./scrim-group";

describe("parseGroupReviewReply", () => {
  it("accepts approval words", () => {
    for (const word of ["تم", "تم ✅", "✅ تم", "قبول", "ok", "OK", "تم."]) {
      expect(parseGroupReviewReply(word)).toBe("accept");
    }
  });
  it("accepts rejection words", () => {
    expect(parseGroupReviewReply("رفض")).toBe("reject");
    expect(parseGroupReviewReply("رفض ❌")).toBe("reject");
  });
  it("ignores normal chatter", () => {
    for (const word of ["تمام يا شباب", "وش صار", "تم تسجيل الكل؟", "", "okay then", null]) {
      expect(parseGroupReviewReply(word)).toBeNull();
    }
  });
});

describe("teamIdFromReviewMarkup", () => {
  it("reads the team id from review buttons", () => {
    expect(
      teamIdFromReviewMarkup({
        inline_keyboard: [[{ callback_data: "sc:ok:team-1" }, { callback_data: "sc:no:team-1" }]],
      }),
    ).toBe("team-1");
  });
  it("returns null without review buttons", () => {
    expect(teamIdFromReviewMarkup(undefined)).toBeNull();
    expect(teamIdFromReviewMarkup({ inline_keyboard: [[{ callback_data: "sc:wl:x" }]] })).toBeNull();
  });
});

describe("settings parsing", () => {
  it("parses group ids", () => {
    expect(parseGroupChatId("-1001234567890")).toBe("-1001234567890");
    expect(parseGroupChatId("1234567")).toBeNull();
    expect(parseGroupChatId("abc")).toBeNull();
  });
  it("parses drops links", () => {
    expect(parseDropsLink("t.me/+abc")).toBe("https://t.me/+abc");
    expect(parseDropsLink("https://t.me/drops")).toBe("https://t.me/drops");
    expect(parseDropsLink("javascript:alert(1)")).toBeNull();
    expect(parseDropsLink("hello")).toBeNull();
  });
  it("detects clear words", () => {
    expect(isClearWord("off")).toBe(true);
    expect(isClearWord("حذف")).toBe(true);
    expect(isClearWord("https://t.me/x")).toBe(false);
  });
});

describe("message helpers", () => {
  it("adds the drops link line only when set", () => {
    expect(withDropsLink("آيدي 1", "https://t.me/x")).toBe("آيدي 1\n\nقروب تحديد النزلات: https://t.me/x");
    expect(withDropsLink("آيدي 1", null)).toBe("آيدي 1");
  });
  it("shows leader username and id", () => {
    expect(displayLeader({ id: "5", username: "abc" })).toBe("@abc (5)");
    expect(displayLeader({ id: "5" })).toBe("5");
  });
});
