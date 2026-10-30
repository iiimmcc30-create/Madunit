import OpenAI from "openai";
import { toFile } from "openai";
import { classifyIntent, type SellerIntent } from "../domain/intent";
import { sanitizeListingText } from "../domain/sanitize";
import { parseMaxTeams, parseRoomCount, type RoomCredentials, type ScrimKind, type ScrimOpenExtract } from "../domain/scrim-types";
import type {
  AgentChatMessage,
  AgentModelTurn,
  AgentToolSpec,
  ListingAnalysis,
  LlmProvider,
  TranscribeInput,
} from "./types";

const ANALYZE_SYSTEM = `You extract PUBG Mobile account listing facts from Saudi dialect Arabic.
Return JSON only.
Never invent skins, weapons, level, price, binding, country, or player id.
If a field is missing, use null or [].
Remove seller contact (usernames, phones, t.me, WhatsApp) from description.
description must be concise Arabic using only facts present in the user text.
JSON shape:
{"level":number|null,"skins":string[],"upgradedWeapons":string[],"binding":string|null,"country":string|null,"playerId":string|null,"price":number|null,"description":string,"hasSellerContact":boolean,"intent":"list_account"|"availability"|"price_negotiate"|"sold"|"general"}`;

const SCRIM_OPEN_SYSTEM = `Extract a PUBG Mobile scrim opening request from Saudi dialect Arabic.
Return JSON only. Never invent values that are not in the text. Use null if missing.
kind is GULF for خليجي or EUROPE for أوروبي/اوروبي.
maxTeams is only 16 or 18.
JSON shape:
{"kind":"GULF"|"EUROPE"|null,"timeLabel":string|null,"maxTeams":16|18|null,"roomCount":number|null,"roomSecret":string|null,"rules":string|null}`;

const ROOM_CREDS_SYSTEM = `Extract custom room id and password from Arabic/English text.
Return JSON only. Never invent. If either is missing use null.
{"roomId":string|null,"password":string|null}`;

const STANDINGS_SYSTEM = `Read a PUBG Mobile custom-room result screenshot.
Return JSON only for places 1-5 that you can actually read.
Never invent kills, places, or tags. If unreadable, omit the row.
{"rows":[{"place":1,"tag":"TEAM","kills":0}],"topKiller":{"name":"player","tag":"TEAM","kills":0}|null}`;

const INTENTS: SellerIntent[] = [
  "list_account",
  "availability",
  "price_negotiate",
  "sold",
  "general",
];

export class OpenAiLlmProvider implements LlmProvider {
  readonly name: string;
  private readonly fastModel: string;

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly timeoutMs: number,
    options: { name?: string; fastModel?: string } = {},
  ) {
    this.name = options.name ?? "openai";
    this.fastModel = options.fastModel ?? "gpt-4o-mini";
  }

  async detectIntent(text: string): Promise<SellerIntent> {
    const parsed = await this.complete("intent", `صنف النية فقط.\n${text}`, this.fastModel);
    const intent = parsed.intent;
    if (typeof intent === "string" && INTENTS.includes(intent as SellerIntent)) {
      return intent as SellerIntent;
    }
    return classifyIntent(text);
  }

  async analyzeListing(text: string): Promise<ListingAnalysis> {
    const parsed = await this.complete("analyze", text, this.fastModel);
    const description = sanitizeListingText(String(parsed.description ?? ""));
    return {
      fields: {
        level: typeof parsed.level === "number" ? parsed.level : undefined,
        skins: Array.isArray(parsed.skins) ? parsed.skins.map(String) : undefined,
        upgradedWeapons: Array.isArray(parsed.upgradedWeapons)
          ? parsed.upgradedWeapons.map(String)
          : undefined,
        binding: parsed.binding ? String(parsed.binding) : undefined,
        country: parsed.country ? String(parsed.country) : undefined,
        playerId: parsed.playerId ? String(parsed.playerId) : undefined,
      },
      price: typeof parsed.price === "number" && parsed.price > 0 ? parsed.price : null,
      description,
      strippedContact: Boolean(parsed.hasSellerContact),
    };
  }

  lastUsage = { inputTokens: 0, outputTokens: 0 };

  async runAgentTurn(input: {
    system: string;
    messages: AgentChatMessage[];
    tools: AgentToolSpec[];
  }): Promise<AgentModelTurn> {
    const tools = input.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: input.system },
      ...input.messages.map((message) => toOpenAiMessage(message)),
    ];
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        temperature: 0.1,
        tools,
        messages,
      },
      { timeout: this.timeoutMs, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    this.lastUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    const choice = response.choices[0]?.message;
    const toolCalls =
      choice?.tool_calls?.flatMap((call) => {
        if (call.type !== "function") return [];
        return [
          {
            id: call.id,
            name: call.function.name,
            arguments: parseToolArgs(call.function.arguments),
          },
        ];
      }) ?? [];
    return {
      content: choice?.content ?? null,
      toolCalls,
      usage: this.lastUsage,
    };
  }

  async transcribeAudio(input: TranscribeInput): Promise<{ text: string }> {
    const file = await toFile(input.buffer, input.fileName || "voice.ogg");
    const result = await this.client.audio.transcriptions.create(
      {
        file,
        model: "whisper-1",
        language: "ar",
      },
      { timeout: this.timeoutMs, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    this.lastUsage = { inputTokens: 0, outputTokens: Math.ceil((result.text?.length ?? 0) / 4) };
    return { text: (result.text ?? "").trim() };
  }

  async summarizeMemory(turns: string[]): Promise<string> {
    const parsed = await this.complete(
      "memory",
      `لخّص بالعربية القصيرة ماذا يريد هذا المستخدم، وميزانيته، والإعلانات اللي تكلم عنها:\n${turns.join("\n").slice(0, 4000)}`,
      this.fastModel,
    );
    return String(parsed.summary ?? parsed.description ?? "").trim().slice(0, 800);
  }

  async extractScrimOpen(text: string): Promise<Partial<ScrimOpenExtract> | null> {
    const parsed = await this.completeJson(SCRIM_OPEN_SYSTEM, text);
    const kind = parsed.kind === "GULF" || parsed.kind === "EUROPE" ? (parsed.kind as ScrimKind) : null;
    return {
      kind,
      timeLabel: parsed.timeLabel ? String(parsed.timeLabel) : null,
      maxTeams: parseMaxTeams(parsed.maxTeams),
      roomCount: parseRoomCount(parsed.roomCount),
      roomSecret: parsed.roomSecret ? String(parsed.roomSecret) : null,
      rules: parsed.rules ? String(parsed.rules) : null,
    };
  }

  async extractRoomCredentials(text: string): Promise<RoomCredentials | null> {
    const parsed = await this.completeJson(ROOM_CREDS_SYSTEM, text);
    const roomId = parsed.roomId ? String(parsed.roomId).trim() : "";
    const password = parsed.password ? String(parsed.password).trim() : "";
    if (!roomId || !password) return null;
    return { roomId, password };
  }

  async readScrimStandingsImage(imageUrl: string): Promise<unknown> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: STANDINGS_SYSTEM },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract only readable top-5 standings. Do not invent numbers.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      },
      { timeout: this.timeoutMs, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    this.lastUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    const raw = response.choices[0]?.message?.content ?? "{}";
    return JSON.parse(raw) as unknown;
  }

  private async complete(operation: string, text: string, model: string): Promise<Record<string, unknown>> {
    const response = await this.client.chat.completions.create(
      {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ANALYZE_SYSTEM },
          { role: "user", content: text },
        ],
      },
      { timeout: this.timeoutMs, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    this.lastUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.__operation = operation;
    return parsed;
  }

  private async completeJson(system: string, text: string): Promise<Record<string, unknown>> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      },
      { timeout: this.timeoutMs, signal: AbortSignal.timeout(this.timeoutMs) },
    );
    this.lastUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    const raw = response.choices[0]?.message?.content ?? "{}";
    return JSON.parse(raw) as Record<string, unknown>;
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toOpenAiMessage(message: AgentChatMessage): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "tool",
      content: message.content,
    };
  }
  if (message.role === "assistant") {
    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        })),
      };
    }
    return { role: "assistant", content: message.content };
  }
  if (message.images && message.images.length > 0) {
    return {
      role: "user",
      content: [
        { type: "text", text: message.content },
        ...message.images.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    };
  }
  return { role: "user", content: message.content };
}
