import { describe, expect, it } from "vitest";
import { loadGlobalGlossary } from "../domain/glossary";
import { NoopLlmProvider } from "../llm/noop";
import { planHeuristic } from "./heuristic";
import { applyHeuristicPlan } from "./execute";
import { rankListings, type SearchableListing } from "./search";
import { runAgentSession } from "./runner";
import type { AgentToolRuntime } from "./tools";
import type { PublicListing } from "./public-listing";

const glossary = loadGlobalGlossary();

const catalog: SearchableListing[] = [
  {
    shortCode: "A001",
    storeId: "s1",
    price: 450,
    description: "لفل 70 مثالية الثلجي ربط جوجل",
    ownerUsername: "cv_91",
    extractedFields: { level: 70, skins: ["مثالية الثلجي"], binding: "جوجل" },
  },
  {
    shortCode: "A007",
    storeId: "s1",
    price: 499,
    description: "مثلية الثلجي M416 مطور أول إيميل",
    ownerUsername: "cv_91",
    extractedFields: { skins: ["مثالية الثلجي"], binding: "أول إيميل" },
  },
  {
    shortCode: "A003",
    storeId: "s1",
    price: 200,
    description: "حساب لفل 20 مفكوك",
    ownerUsername: "cv_91",
    extractedFields: { level: 20, binding: "مفكوك" },
  },
];

function runtime(role: AgentToolRuntime["role"] = "buyer"): AgentToolRuntime {
  let focus: string | null = "A001";
  const requests: unknown[] = [];
  return {
    ownerUsername: "cv_91",
    role,
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
        binding: row.extractedFields?.binding ?? "",
        level: row.extractedFields?.level,
        skins: row.extractedFields?.skins ?? [],
        ownerUsername: row.ownerUsername,
      } satisfies PublicListing;
    },
    async createInquiry(code) {
      return {
        listing: {
          shortCode: code,
          status: "PUBLISHED",
        } as never,
        outcome: "checking",
        buyerMessage: `تمام، نتحقق من ${code} الحين. التسليم عبر المالك فقط.`,
      };
    },
    async saveBuyerRequest(input) {
      requests.push(input);
      return { ok: true, message: "تم. سجّلت طلبك، وأبلغك أول ما ينزل إعلان يطابقه في هالقناة." };
    },
    async listStoreListings() {
      return { ok: true, message: "إعلانات المتجر (2):\nA001 · PUBLISHED · 450 ريال" };
    },
    async listInquiries() {
      return { ok: true, message: "آخر الاستفسارات:\nA001 · WAITING_SELLER" };
    },
    async storeStats() {
      return { ok: true, message: "إحصائيات: 2 إعلان، 1 استفسار." };
    },
    async ownerHelp() {
      return { ok: true, message: "إضافة قناة ثانية من /admin أو /setup." };
    },
    async latestListingShortCode() {
      return "A001";
    },
  };
}

describe("خطة الوكيل للهجة السوق", () => {
  it("يفهم بحث المثاليات بالعامية", () => {
    const plan = planHeuristic("عندكم حساب فيه مثالية الثلجي بأقل من 500؟", {
      glossary,
      focusShortCode: null,
    });
    expect(plan.kind).toBe("search");
    if (plan.kind === "search") {
      expect(plan.filters.maxPrice).toBe(500);
    }
  });

  it("يجاوب فرق الربط وأول إيميل من المعجم", () => {
    const plan = planHeuristic("وش الفرق بين الربط والإيميل الأول؟", {
      glossary,
      focusShortCode: null,
    });
    expect(plan.kind).toBe("glossary");
    if (plan.kind === "glossary") {
      expect(plan.answer).toContain("الربط");
      expect(plan.answer).toMatch(/أول إيميل|اول ايميل/i);
      expect(plan.answer).not.toContain("بائع");
    }
  });

  it("يفهم «طيب وكم آخر سعر؟» من سياق الإعلان", () => {
    const plan = planHeuristic("طيب وكم آخر سعر؟", { glossary, focusShortCode: "A001" });
    expect(plan.kind).toBe("inquire");
    if (plan.kind === "inquire") expect(plan.shortCode).toBe("A001");
  });

  it("يسجّل طلب تبليغ إذا نزل حساب", () => {
    const plan = planHeuristic("بلغني إذا نزل اكس سوت تحت 800", { glossary, focusShortCode: null });
    expect(plan.kind).toBe("save_request");
    if (plan.kind === "save_request") {
      expect(plan.budgetMax).toBe(800);
      expect(plan.skins.join(" ").toLowerCase()).toMatch(/x-suit|اكس/);
    }
  });

  it("كلمة «سوي» وحدها ما تفتح إعلان", () => {
    const plan = planHeuristic("سوي", { glossary, focusShortCode: null, role: "seller" });
    expect(plan.kind).not.toBe("start_listing");
  });

  it("سوي إعلان عند البائع تفتح إعلان", () => {
    const plan = planHeuristic("سوي اعلان", { glossary, focusShortCode: null, role: "seller" });
    expect(plan.kind).toBe("start_listing");
  });

  it("المالك اللي يقول لست مشتري/بايع ياخذ شرح الدور", () => {
    const plan = planHeuristic("لست مشتري ولا بايع", { glossary, focusShortCode: null, role: "owner" });
    expect(plan.kind).toBe("owner_help");
    if (plan.kind === "owner_help") expect(plan.topic).toBe("owner_role");
  });

  it("ممتاز بعد نجاح = رد قصير للمالك", () => {
    const plan = planHeuristic("ممتاز", { glossary, focusShortCode: null, role: "owner" });
    expect(plan.kind).toBe("clarify");
    if (plan.kind === "clarify") expect(plan.question).toMatch(/تم/);
  });

  it("يسأل سؤال واحد إذا ما فهم", () => {
    const plan = planHeuristic("هههه تمام والله", { glossary, focusShortCode: null });
    expect(plan.kind).toBe("clarify");
  });

  it("كان يعامل المالك كمشترٍ لـ «كم إعلان عندي؟» — الآن list_listings", () => {
    expect(planHeuristic("كم إعلان عندي؟", { glossary, focusShortCode: null, role: "buyer" }).kind).toBe("clarify");
    expect(planHeuristic("كم إعلان عندي؟", { glossary, focusShortCode: null, role: "owner" }).kind).toBe("list_listings");
    expect(planHeuristic("وش آخر الاستفسارات؟", { glossary, focusShortCode: null, role: "owner" }).kind).toBe(
      "list_inquiries",
    );
    expect(planHeuristic("احذف آخر إعلان", { glossary, focusShortCode: null, role: "owner" }).kind).toBe("delete_listing");
    const fee = planHeuristic("غيّر الرسوم لـ 10", { glossary, focusShortCode: null, role: "owner" });
    expect(fee.kind).toBe("store_settings");
    if (fee.kind === "store_settings") expect(fee.patch.listingFee).toBe(10);
    expect(planHeuristic("كيف أضيف قناة ثانية؟", { glossary, focusShortCode: null, role: "owner" }).kind).toBe(
      "owner_help",
    );
  });

  it("المسودة العالقة لا تسيطر إذا المالك غيّر الموضوع", () => {
    expect(
      planHeuristic("كم إعلان عندي؟", {
        glossary,
        focusShortCode: null,
        role: "owner",
        hasDraft: true,
      }).kind,
    ).toBe("list_listings");
  });
});

describe("تطبيق الخطة", () => {
  it("يرجع أنسب 3 أو أقل بدون كشف بائع", async () => {
    const plan = planHeuristic("عندكم حساب فيه مثالية الثلجي بأقل من 500؟", {
      glossary,
      focusShortCode: null,
    });
    const result = await applyHeuristicPlan(plan, runtime());
    expect(result.text).toContain("A001");
    expect(result.text).not.toContain("seller");
    expect(result.text).not.toMatch(/05\d{8}/);
    expect(result.unmatched).toBe(false);
  });
});

describe("runAgentSession مع Noop", () => {
  it("يسقط على الفهم العامي إذا الـ LLM فاضي", async () => {
    const result = await runAgentSession({
      llm: new NoopLlmProvider(),
      storeTitle: "متجر التجربة",
      ownerUsername: "cv_91",
      glossary,
      history: [
        { role: "user", text: "ورني الإعلان A001" },
        { role: "assistant", text: "A001 — 450 ريال\nلفل 70 مثالية الثلجي" },
      ],
      focusShortCode: "A001",
      userText: "طيب وكم آخر سعر؟",
      runtime: runtime(),
      role: "buyer",
    });
    expect(result.text).toContain("A001");
    expect(result.text).not.toContain("telegramId");
  });

  it("يتجاهل رد LLM اللي يعامل المالك كزبون ويستخدم أداة الإدارة", async () => {
    const llm = {
      name: "buyerish",
      async detectIntent() {
        return "general" as const;
      },
      async analyzeListing() {
        return { fields: {}, price: null, description: "", strippedContact: false };
      },
      async runAgentTurn() {
        return { content: "تبي تعرض حساب؟", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };
    const result = await runAgentSession({
      llm,
      storeTitle: "متجر التجربة",
      ownerUsername: "cv_91",
      glossary,
      history: [],
      focusShortCode: null,
      userText: "كم إعلان عندي؟",
      runtime: runtime("owner"),
      role: "owner",
    });
    expect(result.text).toContain("إعلانات المتجر");
    expect(result.text).not.toContain("تبي تعرض حساب");
    expect(result.usedTools).toContain("list_store_listings");
  });
});

describe("gulf dialect coverage", () => {
  const base = { glossary: [], focusShortCode: null };
  it("buyer phrasing maps to search / inquire", () => {
    expect(planHeuristic("ودي اشتري حساب ثلجي", { ...base, role: "buyer" }).kind).toBe("search");
    expect(planHeuristic("بكم A012", { ...base, role: "buyer" }).kind).toBe("inquire");
  });
  it("seller phrasing starts a listing", () => {
    expect(planHeuristic("ودي ابيع حسابي", { ...base, role: "seller" }).kind).toBe("start_listing");
  });
  it("owner asking to bind a channel gets channel help", () => {
    expect(planHeuristic("ابي اربط قناة", { ...base, role: "owner" })).toEqual({ kind: "owner_help", topic: "bind_channel" });
  });
  it("unclear text gets example-based guidance, not a dead end", () => {
    const plan = planHeuristic("هلا والله", { ...base, role: "buyer" });
    expect(plan.kind).toBe("clarify");
    expect(plan.kind === "clarify" && plan.question.length).toBeGreaterThan(5);
  });
});


describe("listing ads and seller price reply", () => {
  it("يفهم رقم سعر لوحده كرد على استفسار", () => {
    const plan = planHeuristic("900", {
      glossary,
      focusShortCode: null,
      role: "seller",
      hasDraft: false,
    });
    expect(plan.kind).toBe("seller_reply");
    if (plan.kind === "seller_reply") expect(plan.price).toBe(900);
  });

  it("إعلان طويل مع صورة من بائع يبدأ مسودة", () => {
    const ad =
      "- اعلان\nالسقوط B كامل\nلفل 83\n2 كونكر\n117 مثالي\nسعر 1000\n@iir8rr";
    const plan = planHeuristic(ad, {
      glossary,
      focusShortCode: null,
      role: "seller",
      hasPhoto: true,
    });
    expect(plan.kind).toBe("start_listing");
  });
});

describe("buyer availability vs publish draft", () => {
  const base = { glossary: [], focusShortCode: null as string | null };

  it("موجود ولا انباع → inquire when focus, never mark_sold", () => {
    const plan = planHeuristic("اقصد موجود ولا انباع", {
      ...base,
      focusShortCode: "A100",
      role: "buyer",
    });
    expect(plan.kind).toBe("inquire");
  });

  it("seller saying موجود ولا انباع is availability ask not mark_sold", () => {
    const plan = planHeuristic("موجود ولا انباع", {
      ...base,
      focusShortCode: "A100",
      role: "seller",
    });
    expect(plan.kind).not.toBe("mark_sold");
    expect(plan.kind).toBe("inquire");
  });

  it("forwarded/pasted store ad with media must search not start_listing", () => {
    const ad =
      "لفل 70 بنت فيس اطار طيارة جاكيت سقوط A جاكيت بايكر شورت احمر ماسك نمر كاب S3\nالربط: تغير ايميل\nالقيمه: 850\nمتوفر تابي وتمارا\n@i3xx22";
    const plan = planHeuristic(ad, {
      ...base,
      role: "buyer",
      hasVideo: true,
    });
    expect(plan.kind).toBe("search");
    expect(plan.kind).not.toBe("start_listing");
  });

  it("حوّلت إعلان prefix never starts listing even with video", () => {
    const plan = planHeuristic(
      "حوّلت إعلان موجود — تحقق هل هو منشور/موجود ولا انباع. لا تنشئ مسودة ولا تطلب انشر.\nنص الإعلان:\nلفل 70 سقوط القيمة: 850 @i3xx22 متوفر تابي",
      { ...base, role: "buyer", hasVideo: true },
    );
    expect(plan.kind).not.toBe("start_listing");
  });

  it("موجود alone with pending video context does not start_listing", () => {
    const plan = planHeuristic("موجود", {
      ...base,
      role: "buyer",
      hasVideo: true,
      hasDraft: true,
    });
    expect(plan.kind).not.toBe("start_listing");
    expect(["inquire", "search", "clarify"]).toContain(plan.kind);
  });

  it("متوفر تابي لا يعتبر سؤال توفر", () => {
    const ad =
      "لفل 70 سقوط\nالقيمة: 850\nمتوفر تابي وتمارا\n@i3xx22";
    expect(planHeuristic(ad, { ...base, role: "seller", hasPhoto: true }).kind).toBe("start_listing");
    expect(planHeuristic(ad, { ...base, role: "buyer", hasVideo: true }).kind).not.toBe("start_listing");
  });

  it("explicit sell intent still starts listing", () => {
    const plan = planHeuristic("أبي أبيع حساب سقوط", {
      ...base,
      role: "buyer",
      hasVideo: true,
    });
    expect(plan.kind).toBe("start_listing");
  });

  it("seller with photo + ad still starts listing", () => {
    const ad =
      "- اعلان\nالسقوط B كامل\nلفل 83\n2 كونكر\n117 مثالي\nسعر 1000\n@iir8rr";
    const plan = planHeuristic(ad, {
      ...base,
      role: "seller",
      hasPhoto: true,
    });
    expect(plan.kind).toBe("start_listing");
  });
});
