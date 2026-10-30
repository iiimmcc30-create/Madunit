import { classifyIntent, type SellerIntent } from "../domain/intent";
import { sanitizeListingText } from "../domain/sanitize";
import type {
  AgentChatMessage,
  AgentModelTurn,
  AgentToolSpec,
  ListingAnalysis,
  LlmProvider,
} from "./types";

const ANALYZE_SYSTEM = `Extract PUBG Mobile listing facts from Saudi dialect. JSON only. Never invent facts.
{"level":number|null,"skins":string[],"upgradedWeapons":string[],"binding":string|null,"country":string|null,"playerId":string|null,"price":number|null,"description":string,"hasSellerContact":boolean,"intent":"list_account"|"availability"|"price_negotiate"|"sold"|"general","summary":string}`;

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = "anthropic";
  lastUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly fastModel: string,
  ) {}

  async detectIntent(text: string): Promise<SellerIntent> {
    const parsed = await this.complete(this.fastModel, `صنف النية فقط.\n${text}`);
    const intent = parsed.intent;
    if (
      intent === "list_account" ||
      intent === "availability" ||
      intent === "price_negotiate" ||
      intent === "sold" ||
      intent === "general"
    ) {
      return intent;
    }
    return classifyIntent(text);
  }

  async analyzeListing(text: string): Promise<ListingAnalysis> {
    const parsed = await this.complete(this.fastModel, text);
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
      description: sanitizeListingText(String(parsed.description ?? "")),
      strippedContact: Boolean(parsed.hasSellerContact),
    };
  }

  async summarizeMemory(turns: string[]): Promise<string> {
    const parsed = await this.complete(
      this.fastModel,
      `لخّص ماذا يريد المستخدم وميزانيته:\n${turns.join("\n").slice(0, 4000)}`,
    );
    return String(parsed.summary ?? parsed.description ?? "").trim().slice(0, 800);
  }

  async runAgentTurn(input: {
    system: string;
    messages: AgentChatMessage[];
    tools: AgentToolSpec[];
  }): Promise<AgentModelTurn> {
    const body = {
      model: this.model,
      max_tokens: 1024,
      temperature: 0.2,
      system: input.system,
      tools: input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      messages: toAnthropicMessages(input.messages),
    };
    const payload = await this.post("/v1/messages", body);
    this.lastUsage = {
      inputTokens: Number(payload.usage?.input_tokens ?? 0),
      outputTokens: Number(payload.usage?.output_tokens ?? 0),
    };
    const content = Array.isArray(payload.content) ? payload.content : [];
    const text = content
      .filter((block) => block && block.type === "text")
      .map((block) => String(block.text ?? ""))
      .join("\n")
      .trim();
    const toolCalls = content
      .filter((block) => block && block.type === "tool_use")
      .map((block) => ({
        id: String(block.id ?? "tool"),
        name: String(block.name ?? ""),
        arguments:
          block.input && typeof block.input === "object"
            ? (block.input as Record<string, unknown>)
            : {},
      }));
    return { content: text || null, toolCalls, usage: this.lastUsage };
  }

  private async complete(model: string, text: string): Promise<Record<string, unknown>> {
    const payload = await this.post("/v1/messages", {
      model,
      max_tokens: 400,
      temperature: 0,
      system: ANALYZE_SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    this.lastUsage = {
      inputTokens: Number(payload.usage?.input_tokens ?? 0),
      outputTokens: Number(payload.usage?.output_tokens ?? 0),
    };
    const raw = Array.isArray(payload.content)
      ? payload.content.map((block) => String(block.text ?? "")).join("")
      : "{}";
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async post(path: string, body: unknown): Promise<AnthropicMessage> {
    const response = await fetch(`https://api.anthropic.com${path}`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`anthropic ${response.status}`);
    }
    return (await response.json()) as AnthropicMessage;
  }
}

interface AnthropicMessage {
  content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function toAnthropicMessages(messages: AgentChatMessage[]): Array<{ role: string; content: unknown }> {
  const out: Array<{ role: string; content: unknown }> = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const last = out[out.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId ?? "tool",
        content: message.content,
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      out.push({ role: "assistant", content: content.length ? content : message.content });
      continue;
    }
    if (message.images?.length) {
      const content: unknown[] = [{ type: "text", text: message.content }];
      for (const url of message.images) {
        const parsed = parseDataUrl(url);
        if (parsed) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: parsed.mime, data: parsed.data },
          });
        }
      }
      out.push({ role: "user", content });
      continue;
    }
    out.push({ role: "user", content: message.content });
  }
  return out;
}

function parseDataUrl(url: string): { mime: string; data: string } | null {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mime: match[1], data: match[2] };
}
