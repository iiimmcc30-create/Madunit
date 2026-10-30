import { loadGlobalGlossary } from "../domain/glossary";
import { normalizeUserText } from "../domain/keyboard-ar";
import { planHeuristic } from "../agent/heuristic";
import { planToTool } from "../agent/execute";
import { EVAL_CORPUS, type EvalCase } from "./corpus";
import type { EvalTurn } from "./conversations";

export interface EvalResult {
  id: string;
  text: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: EvalResult[];
  pct: number;
  approxCostUsdPerConversation: number;
}

export function evaluateCase(item: EvalCase): EvalResult {
  const text = normalizeUserText(item.text);
  const plan = planHeuristic(text, {
    glossary: loadGlobalGlossary(),
    focusShortCode: item.focus ?? null,
    role: item.role ?? "buyer",
    hasDraft: Boolean(item.draft),
    hasVideo: item.media === "video",
    hasPhoto: item.media === "photo",
    hasVoice: item.media === "voice",
    lastSearchCodes: item.lastSearch ?? [],
  });
  const actual = planToTool(plan);
  return {
    id: item.id,
    text: item.text,
    expected: item.expect,
    actual,
    ok: actual === item.expect,
  };
}

export function evaluateConversation(turns: EvalTurn[]): EvalReport {
  let draft = false;
  let focus: string | undefined;
  let lastSearch: string[] | undefined;
  const rows = turns.map((turn) => {
    const item: EvalCase = {
      ...turn,
      draft: turn.draft ?? draft,
      focus: turn.focus ?? focus,
      lastSearch: turn.lastSearch ?? lastSearch,
    };
    const result = evaluateCase(item);
    const plan = planHeuristic(normalizeUserText(turn.text), {
      glossary: loadGlobalGlossary(),
      focusShortCode: item.focus ?? null,
      role: item.role ?? "buyer",
      hasDraft: Boolean(item.draft),
      hasVideo: item.media === "video",
      hasPhoto: item.media === "photo",
      hasVoice: item.media === "voice",
      lastSearchCodes: item.lastSearch ?? [],
    });
    if (plan.kind === "start_listing" || plan.kind === "update_draft") draft = true;
    if (plan.kind === "list_listings" || plan.kind === "list_inquiries" || plan.kind === "store_stats" || plan.kind === "owner_help") {
      draft = false;
    }
    if (plan.kind === "search") {
      lastSearch = ["A001", "A007", "A003"];
      focus = "A001";
    }
    if (plan.kind === "get" && plan.shortCode) focus = plan.shortCode;
    if (plan.kind === "inquire") focus = plan.shortCode;
    if (turn.afterDraft !== undefined) draft = turn.afterDraft;
    if (turn.afterFocus !== undefined) focus = turn.afterFocus ?? undefined;
    return result;
  });
  const passed = rows.filter((row) => row.ok).length;
  const total = rows.length;
  return {
    total,
    passed,
    failed: rows.filter((row) => !row.ok),
    pct: total === 0 ? 0 : Math.round((passed / total) * 1000) / 10,
    approxCostUsdPerConversation: estimateConversationCostUsd(),
  };
}

export function evaluateCorpus(cases: EvalCase[] = EVAL_CORPUS): EvalReport {
  const rows = cases.map(evaluateCase);
  const passed = rows.filter((row) => row.ok).length;
  const total = rows.length;
  return {
    total,
    passed,
    failed: rows.filter((row) => !row.ok),
    pct: total === 0 ? 0 : Math.round((passed / total) * 1000) / 10,
    approxCostUsdPerConversation: estimateConversationCostUsd(),
  };
}

/** تقدير gpt-4o: ~8 آلاف توكن إدخال و400 إخراج عبر جولتين أدوات. */
export function estimateConversationCostUsd(
  inputTokens = 8000,
  outputTokens = 400,
  inputPerMillion = 2.5,
  outputPerMillion = 10,
): number {
  return (inputTokens / 1_000_000) * inputPerMillion + (outputTokens / 1_000_000) * outputPerMillion;
}
