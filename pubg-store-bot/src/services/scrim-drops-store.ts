import type Redis from "ioredis";
import { emptyDropsState, type DropsState } from "../domain/scrim-drops";

/** Short-lived drop claims per scrim. Not a DB table: the messages in the drops group are the record. */
export interface DropsStore {
  get(scrimId: string): Promise<DropsState>;
  set(scrimId: string, state: DropsState, ttlSeconds: number): Promise<void>;
  /** Serializes read-modify-write per scrim inside this process. */
  withLock<T>(scrimId: string, fn: () => Promise<T>): Promise<T>;
}

function makeLock() {
  const chains = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    chains.set(key, tail);
    try {
      return await run;
    } finally {
      if (chains.get(key) === tail) chains.delete(key);
    }
  };
}

export function createRedisDropsStore(redis: Redis, storeId: string): DropsStore {
  const key = (scrimId: string) => `psb:drops:${storeId}:${scrimId}`;
  return {
    async get(scrimId) {
      const raw = await redis.get(key(scrimId));
      if (!raw) return emptyDropsState();
      try {
        const parsed = JSON.parse(raw) as DropsState;
        return { spots: parsed.spots ?? {}, teams: parsed.teams ?? {} };
      } catch {
        return emptyDropsState();
      }
    },
    async set(scrimId, state, ttlSeconds) {
      await redis.set(key(scrimId), JSON.stringify(state), "EX", Math.max(60, Math.floor(ttlSeconds)));
    },
    withLock: makeLock(),
  };
}

export function createMemoryDropsStore(): DropsStore {
  const map = new Map<string, DropsState>();
  return {
    async get(scrimId) {
      return map.get(scrimId) ?? emptyDropsState();
    },
    async set(scrimId, state) {
      map.set(scrimId, state);
    },
    withLock: makeLock(),
  };
}
