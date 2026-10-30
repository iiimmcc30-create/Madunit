import { describe, expect, it, vi } from "vitest";
import { LlmGateway, mergeAnalyses } from "./gateway";
import { NoopLlmProvider } from "./noop";
import { createMemoryBudget } from "./budget";
import type { ListingAnalysis, LlmProvider } from "./types";

describe("mergeAnalyses", () => {
  it("keeps regex facts, uses LLM wording, and never restores stripped contact", () => {
    const original = "لفل 60 سكن نادر كلم @seller_x بـ 150 ريال";
    const fallback = {
      fields: { level: 60, binding: undefined },
      price: 150,
      description: "لفل 60\n\nلفل 60 سكن نادر كلم",
      strippedContact: true,
    } satisfies ListingAnalysis;
    const llm = {
      fields: { level: 60, skins: ["نادر"], binding: "جوجل" },
      price: 150,
      description: "لفل 60 سكن نادر ربط جوجل",
      strippedContact: true,
    } satisfies ListingAnalysis;

    const merged = mergeAnalyses(original, fallback, llm);
    expect(merged.fields.binding).toBe("جوجل");
    expect(merged.fields.skins).toEqual(["نادر"]);
    expect(merged.description).not.toContain("seller_x");
    expect(merged.strippedContact).toBe(true);
  });

  it("rejects invented long LLM descriptions", () => {
    const merged = mergeAnalyses("لفل 10", {
      fields: { level: 10 },
      price: null,
      description: "لفل 10",
      strippedContact: false,
    }, {
      fields: { level: 10, skins: ["خيال"] },
      price: null,
      description: "أ".repeat(200),
      strippedContact: false,
    });
    expect(merged.description).toBe("لفل 10");
  });
});

describe("LlmGateway", () => {
  it("falls back when the primary provider throws", async () => {
    const primary: LlmProvider = {
      name: "boom",
      detectIntent: vi.fn(async () => {
        throw new Error("down");
      }),
      analyzeListing: vi.fn(async () => {
        throw new Error("down");
      }),
      runAgentTurn: vi.fn(async () => {
        throw new Error("down");
      }),
    };
    const gateway = new LlmGateway({
      primary,
      fallback: new NoopLlmProvider(),
      budget: createMemoryBudget(5),
      model: "gpt-4o-mini",
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    });

    await expect(gateway.detectIntent("هلا")).resolves.toBe("general");
    const analysis = await gateway.analyzeListing("لفل 40 سعر 90 ريال");
    expect(analysis.fields.level).toBe(40);
    expect(analysis.price).toBe(90);
  });

  it("skips the LLM when the daily budget is exhausted", async () => {
    const primary: LlmProvider = {
      name: "openai",
      detectIntent: vi.fn(async () => "list_account"),
      analyzeListing: vi.fn(async () => ({
        fields: {},
        price: null,
        description: "x",
        strippedContact: false,
      })),
      runAgentTurn: vi.fn(async () => ({
        content: "hi",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    };
    const gateway = new LlmGateway({
      primary,
      fallback: new NoopLlmProvider(),
      budget: createMemoryBudget(0),
      model: "gpt-4o-mini",
      inputPerMillion: 0.15,
      outputPerMillion: 0.6,
    });

    await gateway.detectIntent("وش الأخبار");
    await gateway.analyzeListing("لفل 10");
    expect(primary.detectIntent).not.toHaveBeenCalled();
    expect(primary.analyzeListing).not.toHaveBeenCalled();
    await gateway.runAgentTurn({ system: "x", messages: [], tools: [] });
    expect(primary.runAgentTurn).not.toHaveBeenCalled();
  });
});
