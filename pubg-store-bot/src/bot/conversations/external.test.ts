import { describe, expect, it } from "vitest";
import { AppError } from "../../domain/errors";
import { externalApp } from "./external";

// mimics grammY conversations: results/errors cross a serialization boundary
const fakeConversation = {
  async external(op: () => unknown) {
    try {
      return JSON.parse(JSON.stringify(await op()));
    } catch (error) {
      throw new Error((error as Error).message);
    }
  },
} as never;

describe("externalApp", () => {
  it("keeps AppError userMessage and code across external", async () => {
    const run = externalApp(fakeConversation, () => {
      throw new AppError("bot not admin", "البوت لازم يكون أدمن", "BOT_NOT_ADMIN");
    });
    await expect(run).rejects.toBeInstanceOf(AppError);
    await expect(run).rejects.toMatchObject({ userMessage: "البوت لازم يكون أدمن", code: "BOT_NOT_ADMIN" });
  });
  it("returns values and rethrows other errors", async () => {
    expect(await externalApp(fakeConversation, async () => ({ a: 1 }))).toEqual({ a: 1 });
    await expect(externalApp(fakeConversation, () => { throw new Error("x"); })).rejects.not.toBeInstanceOf(AppError);
  });
});
