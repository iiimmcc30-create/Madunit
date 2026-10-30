import { describe, expect, it } from "vitest";
import { CjClient, parseCjProductRef } from "./cj-client";
import { isSaudiPhone, normalizeSaudiPhone, orderNumber, parseCjPrice, priceFromCost, roundSar, slugify } from "./pricing";
import { orderKey } from "./routes";

describe("pricing", () => {
  it("parses CJ price ranges", () => {
    expect(parseCjPrice("1.90 -- 8.64")).toBe(1.9);
    expect(parseCjPrice(3.5)).toBe(3.5);
    expect(parseCjPrice("")).toBe(0);
  });
  it("prices from cost+shipping with markup and retail rounding", () => {
    // (1.7 + 3.29) * 3.75 * 2.2 = 41.17 → 49
    expect(priceFromCost(1.7, 120, 3.75, 3.29)).toBe(49);
    expect(roundSar(12.1)).toBe(13);
    expect(roundSar(150)).toBe(159);
  });
  it("validates Saudi phones", () => {
    expect(isSaudiPhone("0551234567")).toBe(true);
    expect(isSaudiPhone("+966 55 123 4567")).toBe(true);
    expect(isSaudiPhone("0123456789")).toBe(false);
    expect(normalizeSaudiPhone("0551234567")).toBe("+966551234567");
  });
  it("builds slugs and order numbers", () => {
    expect(slugify("Mobile Game Trigger!", "ABCDEF123456")).toBe("mobile-game-trigger-123456");
    expect(orderNumber(new Date("2026-10-30T00:00:00Z"), 0.5)).toBe("MU26103050000");
  });
});

describe("cj refs", () => {
  it("parses pid or url", () => {
    expect(parseCjProductRef("38a70f8d-bd31-4720-b90d-8094bd174b91")).toBe("38A70F8D-BD31-4720-B90D-8094BD174B91");
    expect(parseCjProductRef("https://cjdropshipping.com/product/x-p-1664111403118108672.html")).toBe("1664111403118108672");
    expect(parseCjProductRef("")).toBeNull();
  });
});

describe("order key", () => {
  it("is stable and secret-dependent", () => {
    expect(orderKey("MU1", "a")).toBe(orderKey("MU1", "a"));
    expect(orderKey("MU1", "a")).not.toBe(orderKey("MU1", "b"));
  });
});

describe("CjClient", () => {
  it("caches the access token and sends it as CJ-Access-Token", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      const data = url.includes("getAccessToken")
        ? { accessToken: "tok", accessTokenExpiryDate: new Date(Date.now() + 86400_000).toISOString() }
        : { totalRecords: 1, content: [{ productList: [{ id: "p1", nameEn: "x", sku: "s", bigImage: "", sellPrice: "1" }] }] };
      return new Response(JSON.stringify({ code: 200, result: true, message: "Success", data }));
    }) as unknown as typeof fetch;
    const c = new CjClient({ apiKey: "k", fetchImpl: fake, minIntervalMs: 0 });
    await c.listProducts({ keyWord: "a" });
    await c.listProducts({ keyWord: "b" });
    expect(calls.filter((x) => x.url.includes("getAccessToken"))).toHaveLength(1);
    expect(calls[1].headers["CJ-Access-Token"]).toBe("tok");
  });
  it("retries on rate limit", async () => {
    let n = 0;
    const fake = (async (url: string) => {
      if (url.includes("getAccessToken"))
        return new Response(JSON.stringify({ code: 200, result: true, message: "ok", data: { accessToken: "t" } }));
      n++;
      if (n === 1) return new Response(JSON.stringify({ code: 1600200, result: false, message: "Too Many Requests", data: null }));
      return new Response(JSON.stringify({ code: 200, result: true, message: "ok", data: [] }));
    }) as unknown as typeof fetch;
    const c = new CjClient({ apiKey: "k", fetchImpl: fake, minIntervalMs: 0, retryDelayMs: 1 });
    await expect(c.variants("p")).resolves.toEqual([]);
    expect(n).toBe(2);
  });
});
