import type { Middleware } from "grammy";
import type Redis from "ioredis";
import type { BotContext } from "../bot/context";

export interface RateLimitOptions {
  windowSeconds: number;
  max: number;
  ownerTelegramId: string;
}

export function createRateLimitMiddleware(
  redis: Redis,
  options: RateLimitOptions,
): Middleware<BotContext> {
  return async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }
    const userId = String(ctx.from?.id ?? "");
    if (!userId || userId === options.ownerTelegramId || options.max <= 0) {
      await next();
      return;
    }
    try {
      const key = `psb:rl:${userId}`;
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, options.windowSeconds);
      }
      if (count > options.max) {
        const message = "تراك مسرع. انتظر شوية وحاول مرة ثانية.";
        if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({ text: message });
          return;
        }
        await ctx.reply(message);
        return;
      }
    } catch {
      // إن تعطل Redis ما نوقف البوت
    }
    await next();
  };
}

export async function hitRateLimit(
  redis: Pick<Redis, "incr" | "expire">,
  userId: string,
  options: { windowSeconds: number; max: number },
): Promise<boolean> {
  const key = `psb:rl:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, options.windowSeconds);
  return count > options.max;
}
