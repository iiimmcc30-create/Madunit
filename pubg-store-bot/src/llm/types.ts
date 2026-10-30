import type { ExtractedFields } from "../domain/extract";
import type { SellerIntent } from "../domain/intent";
import type { RoomCredentials, ScrimOpenExtract } from "../domain/scrim-types";

export type { SellerIntent };

export interface ListingAnalysis {
  fields: ExtractedFields;
  price: number | null;
  description: string;
  strippedContact: boolean;
}

export interface LlmUsageRecord {
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LlmBudget {
  allow(): Promise<boolean>;
  record(usage: LlmUsageRecord): Promise<void>;
  spentUsd?(): Promise<number>;
}

export interface AgentChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: AgentToolCall[];
  images?: string[];
}

export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentModelTurn {
  content: string | null;
  toolCalls: AgentToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface TranscribeInput {
  buffer: Buffer;
  fileName: string;
  mime?: string;
}

export interface LlmProvider {
  readonly name: string;
  detectIntent(text: string): Promise<SellerIntent>;
  analyzeListing(text: string): Promise<ListingAnalysis>;
  runAgentTurn(input: {
    system: string;
    messages: AgentChatMessage[];
    tools: AgentToolSpec[];
  }): Promise<AgentModelTurn>;
  transcribeAudio?(input: TranscribeInput): Promise<{ text: string }>;
  summarizeMemory?(turns: string[]): Promise<string>;
  extractScrimOpen?(text: string): Promise<Partial<ScrimOpenExtract> | null>;
  extractRoomCredentials?(text: string): Promise<RoomCredentials | null>;
  readScrimStandingsImage?(imageUrl: string): Promise<unknown>;
}
