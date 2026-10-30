import { describe, expect, it, vi } from "vitest";
import { hitRateLimit } from "./rate-limit";

describe("hitRateLimit", () => {
  it("allows traffic until the window max, then blocks", async () => {
    let n = 0;
    const redis = {
      incr: vi.fn(async () => {
        n += 1;
        return n;
      }),
      expire: vi.fn(async () => 1),
    };
    expect(await hitRateLimit(redis, "u1", { windowSeconds: 60, max: 2 })).toBe(false);
    expect(await hitRateLimit(redis, "u1", { windowSeconds: 60, max: 2 })).toBe(false);
    expect(await hitRateLimit(redis, "u1", { windowSeconds: 60, max: 2 })).toBe(true);
    expect(redis.expire).toHaveBeenCalledOnce();
  });
});
