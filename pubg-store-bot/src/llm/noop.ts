import {
  composeListingDescription,
  extractFields,
  extractListedPrice,
} from "../domain/extract";
import { classifyIntent, type SellerIntent } from "../domain/intent";
import { heuristicExtractRoomCredentials, heuristicExtractScrimOpen } from "../domain/scrim-parse";
import { hasContactHints, sanitizeListingText } from "../domain/sanitize";
import type { RoomCredentials, ScrimOpenExtract } from "../domain/scrim-types";
import type { AgentModelTurn, ListingAnalysis, LlmProvider } from "./types";

export class NoopLlmProvider implements LlmProvider {
  readonly name = "noop";

  async detectIntent(text: string): Promise<SellerIntent> {
    return classifyIntent(text);
  }

  async analyzeListing(text: string): Promise<ListingAnalysis> {
    const cleaned = sanitizeListingText(text);
    const fields = extractFields(cleaned);
    return {
      fields,
      price: extractListedPrice(text),
      description: composeListingDescription(fields, cleaned),
      strippedContact: hasContactHints(text) || cleaned !== text.trim(),
    };
  }

  async runAgentTurn(): Promise<AgentModelTurn> {
    return { content: null, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async extractScrimOpen(text: string): Promise<Partial<ScrimOpenExtract> | null> {
    return heuristicExtractScrimOpen(text);
  }

  async extractRoomCredentials(text: string): Promise<RoomCredentials | null> {
    return heuristicExtractRoomCredentials(text);
  }

  async readScrimStandingsImage(): Promise<unknown> {
    return null;
  }
}
