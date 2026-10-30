import type { AgentChatMessage, LlmProvider } from "../llm/types";
import type { GlossaryEntry } from "../domain/glossary";
import { wrapUserPayload } from "../domain/prompt-guard";
import { normalizeUserText } from "../domain/keyboard-ar";
import type { ChatTurn } from "./memory";
import { buildAgentSystemPrompt } from "./prompt";
import { looksLikeOwnerAdmin, planHeuristic, type HeuristicPlan } from "./heuristic";
import { applyHeuristicPlan, executeToolCall } from "./execute";
import { safeAgentReply } from "./public-listing";
import { toolSpecsForRole, type AgentMedia, type AgentToolRuntime, type PendingAgentConfirm } from "./tools";
import { isStoreAdmin, type AgentRole } from "./roles";
import type { StoreSnapshot } from "./prompt";

const MAX_TOOL_ROUNDS = 6;

export interface AgentSessionInput {
  llm: LlmProvider;
  storeTitle: string;
  ownerUsername: string;
  glossary: GlossaryEntry[];
  history: ChatTurn[];
  focusShortCode: string | null;
  userText: string;
  runtime: AgentToolRuntime;
  role: AgentRole;
  media?: AgentMedia;
  longTermSummary?: string;
  confirmed?: PendingAgentConfirm | null;
  snapshot?: StoreSnapshot;
}

export interface AgentSessionResult {
  text: string;
  unmatched: boolean;
  usedTools: string[];
  pendingConfirm?: PendingAgentConfirm;
}

function parseToolJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** خطط واضحة ننفّذها قبل الـ LLM عشان ما يغلط بـ create_inquiry على إعلان بيع */
function preferHeuristicFirst(plan: HeuristicPlan): boolean {
  return (
    plan.kind === "start_listing" ||
    plan.kind === "update_draft" ||
    plan.kind === "publish" ||
    plan.kind === "seller_reply" ||
    plan.kind === "search" ||
    plan.kind === "inquire" ||
    plan.kind === "get" ||
    plan.kind === "mark_sold" ||
    plan.kind === "save_request" ||
    plan.kind === "glossary" ||
    plan.kind === "list_listings" ||
    plan.kind === "list_inquiries" ||
    plan.kind === "store_stats" ||
    plan.kind === "owner_help" ||
    plan.kind === "subscription" ||
    plan.kind === "receipt" ||
    plan.kind === "delete_listing" ||
    plan.kind === "store_settings" ||
    plan.kind === "list_stores"
  );
}

export async function runAgentSession(input: AgentSessionInput): Promise<AgentSessionResult> {
  const normalized = normalizeUserText(input.userText);
  const media = input.media ?? input.runtime.media;
  input.runtime.media = media;
  input.runtime.role = input.role;

  if (input.confirmed) {
    input.runtime.confirmed = true;
    const result = await executeToolCall(
      { id: "confirm", name: input.confirmed.tool, arguments: input.confirmed.args },
      input.runtime,
    );
    const parsed = parseToolJson(result.json);
    const text =
      result.finalText ||
      (typeof parsed.message === "string" && parsed.message) ||
      (typeof parsed.error === "string" && parsed.error) ||
      "تم.";
    return {
      text: safeAgentReply(text, input.ownerUsername),
      unmatched: false,
      usedTools: [input.confirmed.tool],
      pendingConfirm: result.pendingConfirm,
    };
  }

  const heuristicCtx = {
    glossary: input.glossary,
    focusShortCode: input.focusShortCode,
    role: input.role,
    hasDraft: Boolean(input.runtime.draft?.videoFileId || input.runtime.draft),
    hasVideo: Boolean(media.videoFileId),
    hasPhoto: Boolean(media.photoFileId),
    hasVoice: Boolean(media.voiceFileId),
    lastSearchCodes: input.runtime.lastSearchCodes,
  };
  const earlyPlan = planHeuristic(normalized, heuristicCtx);
  if (preferHeuristicFirst(earlyPlan) && earlyPlan.kind !== "clarify") {
    const applied = await applyHeuristicPlan(earlyPlan, input.runtime);
    return {
      text: safeAgentReply(applied.text, input.ownerUsername),
      unmatched: applied.unmatched,
      usedTools: applied.usedTools,
      pendingConfirm: applied.pendingConfirm,
    };
  }

  const system = buildAgentSystemPrompt({
    storeTitle: input.storeTitle,
    ownerUsername: input.ownerUsername,
    glossary: input.glossary,
    focusShortCode: input.focusShortCode,
    role: input.role,
    longTermSummary: input.longTermSummary,
    draft: input.runtime.draft,
    media,
    lastSearchCodes: input.runtime.lastSearchCodes,
    snapshot: input.snapshot,
  });
  const messages: AgentChatMessage[] = [
    ...input.history.map((turn) =>
      turn.role === "user"
        ? { role: "user" as const, content: wrapUserPayload(turn.text, { historical: true, role: input.role }) }
        : { role: "assistant" as const, content: turn.text },
    ),
    {
      role: "user",
      content: wrapUserPayload(normalized, {
        role: input.role,
        speaker:
          input.role === "buyer"
            ? "customer"
            : input.role === "seller"
              ? "seller"
              : "store_owner_or_platform_admin_not_a_customer",
        hasPhoto: Boolean(media.photoFileId),
        hasVideo: Boolean(media.videoFileId),
        hasVoice: Boolean(media.voiceFileId),
        focus: input.focusShortCode,
      }),
      images: media.imageDataUrl ? [media.imageDataUrl] : undefined,
    },
  ];

  const usedTools: string[] = [];
  let llmText: string | null = null;
  let pendingConfirm: PendingAgentConfirm | undefined;
  let unmatched = false;
  let llmFailed = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const turn = await input.llm.runAgentTurn({
        system,
        messages,
        tools: toolSpecsForRole(input.role),
      });
      if (!turn.toolCalls.length) {
        llmText = turn.content;
        break;
      }
      messages.push({
        role: "assistant",
        content: turn.content ?? "",
        toolCalls: turn.toolCalls,
      });
      for (const call of turn.toolCalls) {
        usedTools.push(call.name);
        const result = await executeToolCall(call, input.runtime);
        messages.push({
          role: "tool",
          content: result.json,
          toolCallId: call.id,
          name: call.name,
        });
        if (result.pendingConfirm) {
          pendingConfirm = result.pendingConfirm;
          llmText = result.finalText ?? null;
        }
        if (result.finalText && call.name === "ask_clarification") {
          llmText = result.finalText;
          unmatched = true;
        }
        if (result.stopLoop) break;
      }
      if (pendingConfirm || (llmText && usedTools.includes("ask_clarification"))) break;
    }
  } catch {
    llmFailed = true;
  }

  const adminTools = new Set([
    "list_store_listings",
    "list_inquiries",
    "store_stats",
    "list_stores",
    "owner_help",
    "store_settings",
    "delete_listing",
    "subscription_status",
  ]);
  if (isStoreAdmin(input.role) && looksLikeOwnerAdmin(normalized) && !usedTools.some((tool) => adminTools.has(tool))) {
    llmText = null;
    pendingConfirm = undefined;
  }

  if (!llmFailed && pendingConfirm) {
    return {
      text: safeAgentReply(llmText || pendingConfirm.summary, input.ownerUsername),
      unmatched: false,
      usedTools,
      pendingConfirm,
    };
  }

  if (!llmFailed && llmText && llmText.trim()) {
    return {
      text: safeAgentReply(llmText, input.ownerUsername),
      unmatched,
      usedTools,
    };
  }

  const planned = planHeuristic(normalized, heuristicCtx);
  const applied = await applyHeuristicPlan(planned, input.runtime);
  return {
    text: safeAgentReply(applied.text, input.ownerUsername),
    unmatched: applied.unmatched,
    usedTools: applied.usedTools.length ? applied.usedTools : usedTools,
    pendingConfirm: applied.pendingConfirm,
  };
}
