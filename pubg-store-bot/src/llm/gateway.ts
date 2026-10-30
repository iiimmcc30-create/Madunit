import {
  composeListingDescription,
  extractFields,
  extractListedPrice,
  mergeExtractedFields,
} from "../domain/extract";
import { classifyIntent, type SellerIntent } from "../domain/intent";
import { heuristicExtractRoomCredentials, heuristicExtractScrimOpen } from "../domain/scrim-parse";
import { hasContactHints, sanitizeListingText } from "../domain/sanitize";
import type { RoomCredentials, ScrimOpenExtract } from "../domain/scrim-types";
import { estimateCostUsd, estimateTokensFromText } from "./cost";
import type {
  AgentChatMessage,
  AgentModelTurn,
  AgentToolSpec,
  ListingAnalysis,
  LlmBudget,
  LlmProvider,
} from "./types";

export interface GatewayOptions {
  primary?: LlmProvider | null;
  fallback: LlmProvider;
  budget: LlmBudget;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  whisper?: LlmProvider | null;
}

export class LlmGateway implements LlmProvider {
  readonly name: string;
  private readonly primary: LlmProvider | null;
  private readonly fallback: LlmProvider;
  private readonly budget: LlmBudget;
  private readonly model: string;
  private readonly inputPerMillion: number;
  private readonly outputPerMillion: number;
  private readonly whisper: LlmProvider | null;

  constructor(options: GatewayOptions) {
    this.primary = options.primary ?? null;
    this.fallback = options.fallback;
    this.budget = options.budget;
    this.model = options.model;
    this.inputPerMillion = options.inputPerMillion;
    this.outputPerMillion = options.outputPerMillion;
    this.whisper = options.whisper ?? null;
    this.name = this.primary?.name ?? this.fallback.name;
  }

  async detectIntent(text: string): Promise<SellerIntent> {
    const heuristic = classifyIntent(text);
    if (heuristic !== "general" || !this.primary) return heuristic;
    if (!(await this.budget.allow())) return heuristic;
    try {
      const intent = await this.primary.detectIntent(text);
      await this.record("intent", text, this.usageOf(this.primary));
      return intent;
    } catch {
      return heuristic;
    }
  }

  async runAgentTurn(input: {
    system: string;
    messages: AgentChatMessage[];
    tools: AgentToolSpec[];
  }): Promise<AgentModelTurn> {
    if (!this.primary || !(await this.budget.allow())) {
      return this.fallback.runAgentTurn(input);
    }
    try {
      const result = await this.primary.runAgentTurn(input);
      const text = input.messages.map((message) => message.content).join("\n").slice(0, 4000);
      await this.record("agent", text, result.usage);
      return result;
    } catch {
      return this.fallback.runAgentTurn(input);
    }
  }

  async transcribeAudio(input: { buffer: Buffer; fileName: string; mime?: string }) {
    const provider = this.whisper ?? this.primary;
    if (!provider?.transcribeAudio || !(await this.budget.allow())) {
      return { text: "" };
    }
    try {
      const result = await provider.transcribeAudio(input);
      await this.record("transcribe", result.text || input.fileName, this.usageOf(provider));
      return result;
    } catch {
      return { text: "" };
    }
  }

  async summarizeMemory(turns: string[]): Promise<string> {
    if (!this.primary?.summarizeMemory || !(await this.budget.allow())) {
      return this.fallback.summarizeMemory?.(turns) ?? turns.slice(-6).join(" · ").slice(0, 400);
    }
    try {
      const summary = await this.primary.summarizeMemory(turns);
      await this.record("memory", turns.join("\n").slice(0, 1000), this.usageOf(this.primary));
      return summary;
    } catch {
      return turns.slice(-6).join(" · ").slice(0, 400);
    }
  }

  async extractScrimOpen(text: string): Promise<Partial<ScrimOpenExtract> | null> {
    if (this.primary?.extractScrimOpen && (await this.budget.allow())) {
      try {
        const parsed = await this.primary.extractScrimOpen(text);
        await this.record("scrim-open", text, this.usageOf(this.primary));
        if (parsed) return parsed;
      } catch {
        // heuristic fallback
      }
    }
    return heuristicExtractScrimOpen(text);
  }

  async extractRoomCredentials(text: string): Promise<RoomCredentials | null> {
    if (this.primary?.extractRoomCredentials && (await this.budget.allow())) {
      try {
        const parsed = await this.primary.extractRoomCredentials(text);
        await this.record("scrim-room", text, this.usageOf(this.primary));
        if (parsed) return parsed;
      } catch {
        // heuristic fallback
      }
    }
    return heuristicExtractRoomCredentials(text);
  }

  async readScrimStandingsImage(imageUrl: string): Promise<unknown> {
    if (!this.primary?.readScrimStandingsImage || !(await this.budget.allow())) return null;
    try {
      const parsed = await this.primary.readScrimStandingsImage(imageUrl);
      await this.record("scrim-vision", "image", this.usageOf(this.primary));
      return parsed;
    } catch {
      return null;
    }
  }

  async analyzeListing(text: string): Promise<ListingAnalysis> {
    const fallback = await this.fallback.analyzeListing(text);
    if (!this.primary || !(await this.budget.allow())) return fallback;
    try {
      const llm = await this.primary.analyzeListing(text);
      await this.record("analyze", text, this.usageOf(this.primary));
      return mergeAnalyses(text, fallback, llm);
    } catch {
      return fallback;
    }
  }

  private usageOf(provider: LlmProvider): { inputTokens: number; outputTokens: number } {
    if ("lastUsage" in provider) {
      return (provider as { lastUsage: { inputTokens: number; outputTokens: number } }).lastUsage;
    }
    return { inputTokens: 0, outputTokens: 0 };
  }

  private async record(
    operation: string,
    text: string,
    usage: { inputTokens: number; outputTokens: number },
  ) {
    const inputTokens = usage.inputTokens || estimateTokensFromText(text);
    const outputTokens = usage.outputTokens || 0;
    await this.budget.record({
      provider: this.name,
      model: this.model,
      operation,
      inputTokens,
      outputTokens,
      costUsd: estimateCostUsd(
        inputTokens,
        outputTokens,
        this.inputPerMillion,
        this.outputPerMillion,
      ),
    });
  }
}

export function mergeAnalyses(
  original: string,
  fallback: ListingAnalysis,
  llm: ListingAnalysis,
): ListingAnalysis {
  const fields = mergeExtractedFields(fallback.fields, llm.fields);
  const sanitizedLlm = sanitizeListingText(llm.description);
  const tooLong = sanitizedLlm.length > Math.max(40, original.length * 2.5);
  const description = !sanitizedLlm || tooLong
    ? fallback.description
    : composeListingDescription(fields, sanitizedLlm);
  return {
    fields,
    price: llm.price ?? fallback.price ?? extractListedPrice(original) ?? null,
    description,
    strippedContact:
      fallback.strippedContact || llm.strippedContact || hasContactHints(original),
  };
}

export function heuristicAnalysis(text: string): ListingAnalysis {
  const cleaned = sanitizeListingText(text);
  const fields = extractFields(cleaned);
  return {
    fields,
    price: extractListedPrice(text),
    description: composeListingDescription(fields, cleaned),
    strippedContact: hasContactHints(text),
  };
}
