import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SULTAN_AUTO_PUBLISH_LIMIT,
  SULTAN_AUTO_PUBLISH_WINDOW_MS,
  canPublishInRollingWindow,
  dequeueSultanPublish,
  enqueueSultanPublish,
  isSultanBot,
  requeueSultanPublishFront,
  sultanPublishSlotsRemaining,
  sultanQueueKey,
  sultanWindowKey,
  tryClaimSultanPublishSlot,
  type SultanQueuedPublish,
} from "./sultan-auto-publish";

describe("isSultanBot", () => {
  it("matches sultan_sl_bot", () => {
    expect(isSultanBot("sultan_sl_bot")).toBe(true);
    expect(isSultanBot("@Sultan_SL_Bot")).toBe(true);
    expect(isSultanBot("dmstor_bot")).toBe(false);
    expect(isSultanBot("sarhstoree_bot")).toBe(false);
  });
});

describe("canPublishInRollingWindow", () => {
  const window = SULTAN_AUTO_PUBLISH_WINDOW_MS;
  const limit = SULTAN_AUTO_PUBLISH_LIMIT;
  const now = 1_000_000_000_000;

  it("allows when under limit", () => {
    const stamps = Array.from({ length: 9 }, (_, i) => now - i * 1000);
    expect(canPublishInRollingWindow(stamps, now, limit, window)).toBe(true);
  });

  it("blocks when 10 publishes sit inside the window", () => {
    const stamps = Array.from({ length: 10 }, (_, i) => now - i * 1000);
    expect(canPublishInRollingWindow(stamps, now, limit, window)).toBe(false);
  });

  it("ignores stamps older than the window (rolling)", () => {
    const stamps = Array.from({ length: 10 }, (_, i) => now - window - 1 - i);
    expect(canPublishInRollingWindow(stamps, now, limit, window)).toBe(true);
  });

  it("allows the 11th after the oldest ages out", () => {
    // 9 recent + 1 just outside window
    const stamps = [
      ...Array.from({ length: 9 }, (_, i) => now - i * 1000),
      now - window - 1,
    ];
    expect(canPublishInRollingWindow(stamps, now, limit, window)).toBe(true);
  });
});

function makeQueued(id: number): SultanQueuedPublish {
  return {
    chatId: "-1001",
    lockMessageId: id,
    mapMessageIds: [id],
    media: [{ kind: "photo", fileId: `f${id}`, messageId: id }],
    caption: `لفل 70\nسعر ${100 + id}`,
    enqueuedAt: id,
  };
}

describe("sultan redis queue + slots (mock)", () => {
  type FakeRedis = {
    lists: Map<string, string[]>;
    zsets: Map<string, Map<string, number>>;
    eval: ReturnType<typeof vi.fn>;
    rpush: ReturnType<typeof vi.fn>;
    lpop: ReturnType<typeof vi.fn>;
    lpush: ReturnType<typeof vi.fn>;
    llen: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };

  let redis: FakeRedis;

  beforeEach(() => {
    const lists = new Map<string, string[]>();
    const zsets = new Map<string, Map<string, number>>();

    redis = {
      lists,
      zsets,
      expire: vi.fn(async () => 1),
      set: vi.fn(async () => "OK"),
      rpush: vi.fn(async (key: string, value: string) => {
        const arr = lists.get(key) ?? [];
        arr.push(value);
        lists.set(key, arr);
        return arr.length;
      }),
      lpop: vi.fn(async (key: string) => {
        const arr = lists.get(key) ?? [];
        const v = arr.shift();
        lists.set(key, arr);
        return v ?? null;
      }),
      lpush: vi.fn(async (key: string, value: string) => {
        const arr = lists.get(key) ?? [];
        arr.unshift(value);
        lists.set(key, arr);
        return arr.length;
      }),
      llen: vi.fn(async (key: string) => (lists.get(key) ?? []).length),
      eval: vi.fn(async (script: string, _numKeys: number, key: string, nowS: string, windowS: string, limitS: string, member?: string) => {
        const now = Number(nowS);
        const window = Number(windowS);
        const limit = Number(limitS);
        let z = zsets.get(key);
        if (!z) {
          z = new Map();
          zsets.set(key, z);
        }
        for (const [m, score] of [...z.entries()]) {
          if (score <= now - window) z.delete(m);
        }
        if (script.includes("ZADD")) {
          if (z.size >= limit) return 0;
          z.set(member ?? `${now}`, now);
          return 1;
        }
        // count remaining
        const remaining = limit - z.size;
        return remaining < 0 ? 0 : remaining;
      }),
    };
  });

  it("claims up to 10 slots then rejects", async () => {
    const storeId = "store-sultan";
    const now = Date.now();
    for (let i = 0; i < SULTAN_AUTO_PUBLISH_LIMIT; i++) {
      expect(
        await tryClaimSultanPublishSlot(redis as never, storeId, now + i, `m${i}`),
      ).toBe(true);
    }
    expect(
      await tryClaimSultanPublishSlot(redis as never, storeId, now + 100, "overflow"),
    ).toBe(false);
    expect(await sultanPublishSlotsRemaining(redis as never, storeId, now + 100)).toBe(0);
  });

  it("FIFO queue: enqueue then dequeue in order", async () => {
    const storeId = "store-sultan";
    await enqueueSultanPublish(redis as never, storeId, makeQueued(1));
    await enqueueSultanPublish(redis as never, storeId, makeQueued(2));
    expect(redis.lists.get(sultanQueueKey(storeId))?.length).toBe(2);

    const first = await dequeueSultanPublish(redis as never, storeId);
    const second = await dequeueSultanPublish(redis as never, storeId);
    expect(first?.lockMessageId).toBe(1);
    expect(second?.lockMessageId).toBe(2);
    expect(await dequeueSultanPublish(redis as never, storeId)).toBeNull();
  });

  it("requeueFront restores item to head", async () => {
    const storeId = "store-sultan";
    await enqueueSultanPublish(redis as never, storeId, makeQueued(1));
    await enqueueSultanPublish(redis as never, storeId, makeQueued(2));
    const item = await dequeueSultanPublish(redis as never, storeId);
    expect(item?.lockMessageId).toBe(1);
    await requeueSultanPublishFront(redis as never, storeId, item!);
    const again = await dequeueSultanPublish(redis as never, storeId);
    expect(again?.lockMessageId).toBe(1);
  });

  it("frees a slot after the rolling window ages out", async () => {
    const storeId = "store-sultan";
    const t0 = 5_000_000;
    for (let i = 0; i < SULTAN_AUTO_PUBLISH_LIMIT; i++) {
      await tryClaimSultanPublishSlot(redis as never, storeId, t0, `old${i}`);
    }
    expect(
      await tryClaimSultanPublishSlot(redis as never, storeId, t0 + 1, "blocked"),
    ).toBe(false);

    const later = t0 + SULTAN_AUTO_PUBLISH_WINDOW_MS + 1;
    expect(
      await tryClaimSultanPublishSlot(redis as never, storeId, later, "fresh"),
    ).toBe(true);
    expect(sultanWindowKey(storeId)).toContain("psb:traders:sultan:window:");
  });
});
