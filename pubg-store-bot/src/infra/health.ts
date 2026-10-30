import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";

export function liveness() {
  return {
    ok: true,
    service: "pubg-store-bot",
    uptime: process.uptime(),
  };
}

export async function readiness(
  db: Pick<PrismaClient, "$queryRaw">,
  redis: Pick<Redis, "ping">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.$queryRaw`SELECT 1`;
    const pong = await redis.ping();
    if (pong !== "PONG" && pong !== "pong") {
      return { ok: false, error: "redis ping failed" };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unhealthy",
    };
  }
}
