import type Redis from "ioredis";

/** Max auto-mirrored ads for sultan_sl_bot per rolling window. */
export const SULTAN_AUTO_PUBLISH_LIMIT = 10;
/** Rolling window length (2 hours). */
export const SULTAN_AUTO_PUBLISH_WINDOW_MS = 2 * 60 * 60 * 1000;

export const SULTAN_BOT_USERNAME = "sultan_sl_bot";
/** Bots that behave exactly like Sultan (same mirror/sold/price/drop rules). */
export const SULTAN_STYLE_BOTS = ["sultan_sl_bot", "s3dstore_bot"] as const;

export function isSultanBot(botUsername: string | null | undefined): boolean {
  const u = (botUsername ?? "").replace(/^@/, "").trim().toLowerCase();
  return (SULTAN_STYLE_BOTS as readonly string[]).includes(u);
}

export function sultanWindowKey(storeId: string): string {
  return `psb:traders:sultan:window:${storeId}`;
}

export function sultanQueueKey(storeId: string): string {
  return `psb:traders:sultan:queue:${storeId}`;
}

export function sultanDrainLockKey(storeId: string): string {
  return `psb:traders:sultan:drain:${storeId}`;
}

export type SultanQueuedMedia = {
  kind: "photo" | "video";
  fileId: string;
  messageId: number;
  fromUserId?: string;
};

export type SultanQueuedPublish = {
  chatId: string;
  lockMessageId: number;
  mapMessageIds: number[];
  media: SultanQueuedMedia[];
  caption: string;
  enqueuedAt: number;
};

type RedisLike = Pick<
  Redis,
  "eval" | "rpush" | "lpop" | "llen" | "lpush" | "expire" | "set"
>;

const CLAIM_SLOT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window + 60000)
return 1
`;

const COUNT_SLOTS_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
local remaining = limit - count
if remaining < 0 then return 0 end
return remaining
`;

/**
 * Claim one publish slot in the rolling 2h window.
 * Returns true when the caller may publish now.
 */
export async function tryClaimSultanPublishSlot(
  redis: RedisLike,
  storeId: string,
  nowMs: number = Date.now(),
  memberId?: string,
): Promise<boolean> {
  const member =
    memberId ?? `${nowMs}:${Math.random().toString(36).slice(2, 10)}`;
  try {
    const result = await redis.eval(
      CLAIM_SLOT_LUA,
      1,
      sultanWindowKey(storeId),
      String(nowMs),
      String(SULTAN_AUTO_PUBLISH_WINDOW_MS),
      String(SULTAN_AUTO_PUBLISH_LIMIT),
      member,
    );
    return Number(result) === 1;
  } catch {
    // Fail open if Redis script errors — do not block publish forever
    return true;
  }
}

/** How many more ads can publish in the current rolling window. */
export async function sultanPublishSlotsRemaining(
  redis: RedisLike,
  storeId: string,
  nowMs: number = Date.now(),
): Promise<number> {
  try {
    const result = await redis.eval(
      COUNT_SLOTS_LUA,
      1,
      sultanWindowKey(storeId),
      String(nowMs),
      String(SULTAN_AUTO_PUBLISH_WINDOW_MS),
      String(SULTAN_AUTO_PUBLISH_LIMIT),
    );
    const n = Number(result);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return SULTAN_AUTO_PUBLISH_LIMIT;
  }
}

const QUEUE_TTL_SEC = 60 * 60 * 24 * 14; // 14d — match traders dedupe horizon

/** Enqueue a pending mirror publish (FIFO via RPUSH / LPOP). */
export async function enqueueSultanPublish(
  redis: RedisLike,
  storeId: string,
  payload: SultanQueuedPublish,
): Promise<void> {
  const key = sultanQueueKey(storeId);
  await redis.rpush(key, JSON.stringify(payload));
  await redis.expire(key, QUEUE_TTL_SEC);
}

/** Pop the oldest queued publish, or null if empty / bad JSON. */
export async function dequeueSultanPublish(
  redis: RedisLike,
  storeId: string,
): Promise<SultanQueuedPublish | null> {
  const raw = await redis.lpop(sultanQueueKey(storeId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SultanQueuedPublish;
  } catch {
    return null;
  }
}

/** Push an item back to the front of the queue (after a failed slot claim). */
export async function requeueSultanPublishFront(
  redis: RedisLike,
  storeId: string,
  payload: SultanQueuedPublish,
): Promise<void> {
  const key = sultanQueueKey(storeId);
  await redis.lpush(key, JSON.stringify(payload));
  await redis.expire(key, QUEUE_TTL_SEC);
}

export async function sultanQueueLength(
  redis: RedisLike,
  storeId: string,
): Promise<number> {
  try {
    return await redis.llen(sultanQueueKey(storeId));
  } catch {
    return 0;
  }
}

/** Store-scoped drain lock so concurrent timers do not double-publish. */
export async function tryAcquireSultanDrainLock(
  redis: RedisLike,
  storeId: string,
  ttlSec = 25,
): Promise<boolean> {
  try {
    const fresh = await redis.set(
      sultanDrainLockKey(storeId),
      "1",
      "EX",
      ttlSec,
      "NX",
    );
    return Boolean(fresh);
  } catch {
    return false;
  }
}

/**
 * Pure helper for tests: given publish timestamps in the window, can we add one more?
 */
export function canPublishInRollingWindow(
  publishTimestampsMs: number[],
  nowMs: number,
  limit: number = SULTAN_AUTO_PUBLISH_LIMIT,
  windowMs: number = SULTAN_AUTO_PUBLISH_WINDOW_MS,
): boolean {
  const cutoff = nowMs - windowMs;
  const inWindow = publishTimestampsMs.filter((t) => t > cutoff);
  return inWindow.length < limit;
}
