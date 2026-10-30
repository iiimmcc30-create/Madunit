import { describe, expect, it } from "vitest";
import { loadGlobalGlossary } from "../domain/glossary";
import type { AgentModelTurn, LlmProvider } from "../llm/types";
import { rankListings, type SearchableListing } from "./search";
import { runAgentSession } from "./runner";
import type { AgentToolRuntime } from "./tools";

const glossary = loadGlobalGlossary();

class ScriptedLlm implements LlmProvider {
  readonly name = "scripted";
  constructor(private readonly turns: AgentModelTurn[]) {}
  async detectIntent() {
    return "general" as const;
  }
  async analyzeListing() {
    return { fields: {}, price: null, description: "", strippedContact: false };
  }
  async runAgentTurn(): Promise<AgentModelTurn> {
    return (
      this.turns.shift() ?? {
        content: "هذا المعروض من الإعلانات المنشورة، التسليم عبر المالك فقط.",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    );
  }
}

const catalog: SearchableListing[] = [
  {
    shortCode: "A001",
    storeId: "s1",
    price: 450,
    description: "مثالية الثلجي لفل 70",
    ownerUsername: "cv_91",
    extractedFields: { skins: ["مثالية الثلجي"], level: 70 },
  },
  {
    shortCode: "A009",
    storeId: "s1",
    price: 300,
    description: "مثالية الثلجي لفل 55",
    ownerUsername: "cv_91",
    extractedFields: { skins: ["مثالية الثلجي"], level: 55 },
  },
];

function runtime(): AgentToolRuntime {
  let focus: string | null = null;
  return {
    ownerUsername: "cv_91",
    role: "buyer",
    confirmed: false,
    media: {},
    draft: null,
    lastSearchCodes: [],
    longTermSummary: "",
    get focusShortCode() {
      return focus;
    },
    async setFocus(code) {
      focus = code;
    },
    async searchListings(filters) {
      return rankListings(catalog, filters, glossary);
    },
    async getListing(code) {
      const row = catalog.find((item) => item.shortCode === code);
      if (!row) return null;
      return {
        shortCode: row.shortCode,
        storeId: row.storeId,
        price: row.price,
        description: row.description,
        binding: "",
        level: row.extractedFields?.level,
        skins: row.extractedFields?.skins ?? [],
        ownerUsername: row.ownerUsername,
      };
    },
    async createInquiry(code) {
      return {
        listing: { shortCode: code } as never,
        outcome: "checking",
        buyerMessage: `نتحقق من ${code}. التسليم عبر المالك فقط.`,
      };
    },
    async saveBuyerRequest() {
      return { ok: true, message: "تم تسجيل الطلب." };
    },
  };
}

describe("وكيل الأدوات", () => {
  it("يستدعي search_listings ويرد بأعلى النتائج بدون البائع", async () => {
    const llm = new ScriptedLlm([
      {
        content: null,
        toolCalls: [
          {
            id: "call-1",
            name: "search_listings",
            arguments: { query: "مثالية الثلجي", maxPrice: 500 },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        content:
          "أنسب 3 عندنا: A009 بـ 300 و A001 بـ 450. التسليم والشراء عبر المالك @cv_91 فقط.",
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 30 },
      },
    ]);

    const result = await runAgentSession({
      llm,
      storeTitle: "قناة الحسابات",
      ownerUsername: "cv_91",
      glossary,
      history: [],
      focusShortCode: null,
      userText: "عندكم حساب فيه مثالية الثلجي بأقل من 500؟",
      runtime: runtime(),
      role: "buyer",
    });

    expect(result.usedTools).toContain("search_listings");
    expect(result.text).toContain("A009");
    expect(result.text).toContain("A001");
    expect(result.text).not.toContain("sellerId");
    expect(result.text).toContain("@cv_91");
  });

  it("يمنع اختراع يوزر بائع في الرد النهائي", async () => {
    const llm = new ScriptedLlm([
      {
        content: "كلم البائع @hidden_seller على 0555555555",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    const result = await runAgentSession({
      llm,
      storeTitle: "قناة الحسابات",
      ownerUsername: "cv_91",
      glossary,
      history: [],
      focusShortCode: null,
      userText: "من البائع؟",
      runtime: runtime(),
      role: "buyer",
    });
    expect(result.text).not.toContain("hidden_seller");
    expect(result.text).not.toContain("0555555555");
  });
});
