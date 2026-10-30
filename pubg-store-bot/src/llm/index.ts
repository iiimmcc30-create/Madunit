import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import type { AppConfig } from "../config";
import { AnthropicLlmProvider } from "./anthropic";
import { createLlmBudget } from "./budget";
import { LlmGateway } from "./gateway";
import { NoopLlmProvider } from "./noop";
import { OpenAiLlmProvider } from "./openai";
import type { LlmProvider } from "./types";

export type { ListingAnalysis, LlmProvider, SellerIntent } from "./types";
export { NoopLlmProvider } from "./noop";
export { LlmGateway } from "./gateway";

export function resolveProviderModel(provider: string, model: string): string {
  if (provider === "grok" && model.startsWith("gpt-")) return "grok-2-latest";
  if (provider === "anthropic" && model.startsWith("gpt-")) return "claude-sonnet-4-5";
  return model;
}

export function createLlmProvider(
  config: AppConfig,
  redis: Redis,
  db: PrismaClient,
  hooks?: { onBudgetLow?: (spentUsd: number, capUsd: number) => Promise<void> },
): LlmProvider {
  const fallback = new NoopLlmProvider();
  const budget = createLlmBudget(redis, db, config.LLM_DAILY_BUDGET_USD, hooks?.onBudgetLow);
  const providerName = config.LLM_PROVIDER;
  const model = resolveProviderModel(providerName, config.LLM_MODEL);
  const fastModel = config.LLM_FAST_MODEL;
  const primary = buildPrimary(config, providerName, model, fastModel);

  return new LlmGateway({
    primary,
    fallback,
    budget,
    model,
    inputPerMillion: config.LLM_INPUT_PRICE_PER_MILLION,
    outputPerMillion: config.LLM_OUTPUT_PRICE_PER_MILLION,
    whisper: whisperProvider(config),
  });
}

function whisperProvider(config: AppConfig): LlmProvider | null {
  if (!config.OPENAI_API_KEY.trim()) return null;
  return new OpenAiLlmProvider(
    new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: config.LLM_TIMEOUT_MS }),
    config.LLM_MODEL,
    config.LLM_TIMEOUT_MS,
    { name: "openai", fastModel: config.LLM_FAST_MODEL },
  );
}

function buildPrimary(
  config: AppConfig,
  providerName: string,
  model: string,
  fastModel: string,
): LlmProvider | null {
  if (providerName === "noop") return null;
  if (providerName === "grok") {
    const key = config.XAI_API_KEY.trim();
    if (!key) return null;
    return new OpenAiLlmProvider(
      new OpenAI({
        apiKey: key,
        timeout: config.LLM_TIMEOUT_MS,
        baseURL: "https://api.x.ai/v1",
      }),
      model,
      config.LLM_TIMEOUT_MS,
      { name: "grok", fastModel },
    );
  }
  if (providerName === "anthropic") {
    const key = config.ANTHROPIC_API_KEY.trim();
    if (!key) return null;
    return new AnthropicLlmProvider(key, model, config.LLM_TIMEOUT_MS, fastModel);
  }
  if (!config.OPENAI_API_KEY.trim()) return null;
  return new OpenAiLlmProvider(
    new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: config.LLM_TIMEOUT_MS }),
    model,
    config.LLM_TIMEOUT_MS,
    { name: "openai", fastModel },
  );
}
