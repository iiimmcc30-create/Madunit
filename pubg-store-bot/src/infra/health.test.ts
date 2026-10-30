import { describe, expect, it, vi } from "vitest";
import { liveness, readiness } from "./health";

describe("health", () => {
  it("reports liveness without dependencies", () => {
    const live = liveness();
    expect(live.ok).toBe(true);
    expect(live.service).toBe("pubg-store-bot");
  });

  it("is ready when postgres and redis answer", async () => {
    const db = { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) };
    const redis = { ping: vi.fn(async () => "PONG") };
    await expect(readiness(db as never, redis)).resolves.toEqual({ ok: true });
  });

  it("fails ready when redis is down", async () => {
    const db = { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) };
    const redis = { ping: vi.fn(async () => {
      throw new Error("redis down");
    }) };
    const result = await readiness(db as never, redis);
    expect(result.ok).toBe(false);
  });
});
