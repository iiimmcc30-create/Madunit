import type { Middleware } from "grammy";
import type Redis from "ioredis";
import type { BotContext } from "../bot/context";

export function createUpdateDedupeMiddleware(redis: Redis, storeId: string): Middleware<BotContext> {
  return async (ctx, next) => {
    const updateId = ctx.update?.update_id;
    if (updateId === undefined) {
      await next();
      return;
    }
    try {
      const key = `psb:upd:${storeId}:${updateId}`;
      const fresh = await redis.set(key, "1", "EX", 180, "NX");
      if (!fresh) return;
    } catch {
      // إذا تعطل Redis نكمّل بدل ما نوقف البوت
    }
    await next();
  };
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function acquirePollingLock(
  redis: Redis,
  storeId: string,
  holder: string,
  ttlSeconds = 45,
): Promise<boolean> {
  const key = `psb:poll:${storeId}`;
  const ok = await redis.set(key, holder, "EX", ttlSeconds, "NX");
  if (ok) return true;
  const current = await redis.get(key);
  const pid = Number(String(current ?? "").split(":")[0]);
  if (current && current !== holder && isPidAlive(pid)) return false;
  await redis.set(key, holder, "EX", ttlSeconds);
  return true;
}

export async function refreshPollingLock(
  redis: Redis,
  storeId: string,
  holder: string,
  ttlSeconds = 45,
): Promise<boolean> {
  const key = `psb:poll:${storeId}`;
  const current = await redis.get(key);
  if (current && current !== holder) return false;
  await redis.set(key, holder, "EX", ttlSeconds);
  return true;
}

export async function releasePollingLock(redis: Redis, storeId: string, holder: string): Promise<void> {
  const key = `psb:poll:${storeId}`;
  const current = await redis.get(key);
  if (current === holder) await redis.del(key);
}
