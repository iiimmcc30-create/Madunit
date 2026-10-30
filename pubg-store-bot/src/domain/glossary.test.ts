import { describe, expect, it } from "vitest";
import {
  answerGlossaryQuestion,
  expandQueryTerms,
  loadGlobalGlossary,
  mergeGlossary,
  parseGlossaryText,
} from "./glossary";

const glossary = [
  {
    term: "مثالية الثلجي",
    aliases: ["الثلجي"],
    meaning: "سكن مثالي لـ M416 بلون ثلجي.",
  },
  {
    term: "أول إيميل",
    aliases: ["اول ايميل"],
    meaning: "الإيميل الأساسي اللي انفتح فيه الحساب.",
  },
  {
    term: "الربط",
    aliases: ["ربط"],
    meaning: "طريقة ربط الحساب مثل جوجل أو فيسبوك.",
  },
];

describe("glossary", () => {
  it("loads the editable global glossary file", () => {
    const loaded = loadGlobalGlossary();
    expect(loaded.some((row) => row.term.includes("ثلجي") || row.aliases?.includes("الثلجي"))).toBe(true);
    expect(loaded.some((row) => row.term.includes("X-Suit"))).toBe(true);
  });

  it("parses store terms from dialect lines", () => {
    const parsed = parseGlossaryText("الجلدي = سكن محلي عندنا\n# تجاهل\nبدون فاصل");
    expect(parsed).toEqual([{ term: "الجلدي", meaning: "سكن محلي عندنا" }]);
  });

  it("answers a meaning question from aliases", () => {
    const answer = answerGlossaryQuestion("وش الفرق بين الربط وأول إيميل؟", glossary);
    expect(answer).toContain("الربط");
    expect(answer).toContain("أول إيميل");
    expect(answer).not.toContain("بائع");
  });

  it("expands icy mythic search terms", () => {
    const terms = expandQueryTerms("مثالية الثلجي بأقل من 500", glossary);
    expect(terms.some((term) => term.includes("ثلجي"))).toBe(true);
  });

  it("lets store terms override the global meaning", () => {
    const merged = mergeGlossary(glossary, [
      { term: "مثالية الثلجي", meaning: "عندنا نقصد فيها سكن خاص للقناة" },
    ]);
    expect(merged.find((row) => row.term === "مثالية الثلجي")?.meaning).toContain("خاص للقناة");
  });
});
