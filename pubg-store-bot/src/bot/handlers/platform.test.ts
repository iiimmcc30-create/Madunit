import { describe, expect, it } from "vitest";
import { matchStores, resolveAdminIntent } from "./platform";

const stores = [
  { id: "1", botUsername: "Aramstoree_bot", title: "ارام ستور", ownerUsername: "aram", botFirstName: "Aram" },
  { id: "2", botUsername: "Bootpubg_bot", title: "بوت ببجي", ownerUsername: "boot", botFirstName: "Boot" },
] as never[];

describe("platform intent routing", () => {
  it("matches stores by @username or Arabic title", () => {
    expect(matchStores(stores, "@Aramstoree_bot").map((s: { id: string }) => s.id)).toEqual(["1"]);
    expect(matchStores(stores, "ارام").map((s: { id: string }) => s.id)).toEqual(["1"]);
    expect(matchStores(stores, undefined)).toEqual([]);
  });
  it("uses heuristic first, then LLM json fallback", async () => {
    const deps = {
      llm: { name: "fake", runAgentTurn: async () => ({ content: '{"kind":"status"}', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } }) },
      logger: { warn() {} },
    } as never;
    expect((await resolveAdminIntent(deps, "ضيف بوت")).kind).toBe("add_bot");
    expect((await resolveAdminIntent(deps, "طمني على الوضع العام")).kind).toBe("status");
  });
  it("noop LLM falls back to unknown", async () => {
    const deps = { llm: { name: "noop" }, logger: { warn() {} } } as never;
    expect((await resolveAdminIntent(deps, "طمني على الوضع العام")).kind).toBe("unknown");
  });
});
