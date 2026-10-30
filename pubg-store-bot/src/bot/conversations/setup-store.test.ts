import { describe, expect, it } from "vitest";
import { AppError, ConflictError } from "../../domain/errors";
import { setupErrorMessage } from "./setup-store";
import { texts } from "../texts";

describe("setupErrorMessage", () => {
  it("shows the real reason with steps for missing admin rights", () => {
    const msg = setupErrorMessage(new AppError("bot not admin", "الصلاحية الناقصة: نشر الرسائل.", "BOT_NOT_ADMIN"), "x");
    expect(msg).toContain("نشر الرسائل");
    expect(msg).toContain("المشرفين");
  });
  it("explains channel taken vs trial used", () => {
    expect(setupErrorMessage(new ConflictError("channel taken", "..."), "x")).toBe(texts.setupChannelTaken);
    expect(setupErrorMessage(new ConflictError("trial channel", "..."), "x")).toBe(texts.setupTrialUsed);
  });
  it("falls back only for non-app errors", () => {
    expect(setupErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
    expect(setupErrorMessage(new AppError("a", "رسالة واضحة", "X"), "fallback")).toBe("رسالة واضحة");
  });
  it("gives group-specific admin steps", () => {
    const msg = setupErrorMessage(
      new AppError("bot not admin", "البوت لازم يكون أدمن في المجموعة ويقدر ينشر.", "BOT_NOT_ADMIN"),
      "x",
    );
    expect(msg).toContain("/bind");
    expect(setupErrorMessage(new AppError("a", "لازم تكون أنت مشرف", "ACTOR_NOT_ADMIN"), "x")).toContain("مشرف");
  });
});
