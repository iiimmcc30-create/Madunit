import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type Redis from "ioredis";
import type { LlmBudget, LlmUsageRecord } from "./types";

function spendKey(day = new Date()) {
  return `psb:llm:spend:${day.toISOString().slice(0, 10)}`;
}

export function createLlmBudget(
  redis: Redis,
  db: PrismaClient,
  dailyBudgetUsd: number,
  onBudgetLow?: (spentUsd: number, capUsd: number) => Promise<void>,
): LlmBudget {
  return {
    async allow() {
      if (dailyBudgetUsd <= 0) return false;
      const spent = Number((await redis.get(spendKey())) ?? 0);
      return spent < dailyBudgetUsd;
    },
    async spentUsd() {
      return Number((await redis.get(spendKey())) ?? 0);
    },
    async record(usage: LlmUsageRecord) {
      const key = spendKey();
      const spent = Number(await redis.incrbyfloat(key, usage.costUsd));
      await redis.expire(key, 60 * 60 * 72);
      await db.llmUsage
        .create({
          data: {
            provider: usage.provider,
            model: usage.model,
            operation: usage.operation,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: new Prisma.Decimal(usage.costUsd.toFixed(8)),
          },
        })
        .catch(() => undefined);
      if (dailyBudgetUsd > 0 && spent >= dailyBudgetUsd * 0.85 && onBudgetLow) {
        const alertKey = `psb:llm:alert:${new Date().toISOString().slice(0, 10)}`;
        const first = await redis.set(alertKey, "1", "EX", 60 * 60 * 36, "NX");
        if (first === "OK") {
          await onBudgetLow(spent, dailyBudgetUsd).catch(() => undefined);
        }
      }
    },
  };
}

export function createMemoryBudget(dailyBudgetUsd = 10, spent = { value: 0 }): LlmBudget {
  return {
    async allow() {
      return dailyBudgetUsd > 0 && spent.value < dailyBudgetUsd;
    },
    async spentUsd() {
      return spent.value;
    },
    async record(usage) {
      spent.value += usage.costUsd;
    },
  };
}
