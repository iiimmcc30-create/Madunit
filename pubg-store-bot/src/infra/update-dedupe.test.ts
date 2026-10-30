import { describe, expect, it } from "vitest";
import type Redis from "ioredis";
import { acquirePollingLock, createUpdateDedupeMiddleware, refreshPollingLock, releasePollingLock } from "./update-dedupe";

function memoryRedis(): Redis {
  const kv = new Map<string, string>();
  return {
    async set(key: string, value: string, ...rest: unknown[]) {
      const nx = rest.includes("NX");
      if (nx && kv.has(key)) return null;
      kv.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async del(key: string) {
      return kv.delete(key) ? 1 : 0;
    },
  } as unknown as Redis;
}

describe("dedupe التحديثات وقفل polling", () => {
  it("يمرر أول update_id ويوقف التكرار", async () => {
    const redis = memoryRedis();
    const mw = createUpdateDedupeMiddleware(redis, "store-1");
    let ran = 0;
    const ctx = { update: { update_id: 9 } } as never;
    await mw(ctx, async () => {
      ran += 1;
    });
    await mw(ctx, async () => {
      ran += 1;
    });
    expect(ran).toBe(1);
  });

  it("يقفل polling لنفس المتجر", async () => {
    const redis = memoryRedis();
    const live = `${process.pid}:s1`;
    const other = `${process.pid}:other`;
    await expect(acquirePollingLock(redis, "s1", live)).resolves.toBe(true);
    await expect(acquirePollingLock(redis, "s1", other)).resolves.toBe(false);
    await expect(refreshPollingLock(redis, "s1", live)).resolves.toBe(true);
    await expect(refreshPollingLock(redis, "s1", other)).resolves.toBe(false);
    await releasePollingLock(redis, "s1", live);
    await expect(acquirePollingLock(redis, "s1", other)).resolves.toBe(true);
  });
});
