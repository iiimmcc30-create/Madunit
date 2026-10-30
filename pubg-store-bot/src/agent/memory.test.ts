import { describe, expect, it } from "vitest";
import type Redis from "ioredis";
import { createChatMemory } from "./memory";

function memoryRedis(): Redis {
  const lists = new Map<string, string[]>();
  const kv = new Map<string, string>();
  return {
    async lrange(key: string, start: number, stop: number) {
      const arr = lists.get(key) ?? [];
      const from = start < 0 ? arr.length + start : start;
      const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
      return arr.slice(Math.max(0, from), Math.max(0, end));
    },
    async rpush(key: string, value: string) {
      const arr = lists.get(key) ?? [];
      arr.push(value);
      lists.set(key, arr);
      return arr.length;
    },
    async ltrim(key: string, start: number, stop: number) {
      const arr = lists.get(key) ?? [];
      const from = start < 0 ? arr.length + start : start;
      const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
      lists.set(key, arr.slice(Math.max(0, from), Math.max(0, end)));
      return "OK";
    },
    async expire() {
      return 1;
    },
    async lindex(key: string, index: number) {
      const arr = lists.get(key) ?? [];
      const i = index < 0 ? arr.length + index : index;
      return arr[i] ?? null;
    },
    async set(key: string, value: string) {
      kv.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const key of keys) {
        if (kv.has(key) || lists.has(key)) n += 1;
        kv.delete(key);
        lists.delete(key);
      }
      return n;
    },
  } as unknown as Redis;
}

describe("ذاكرة المحادثة", () => {
  it("يحفظ آخر 20 رسالة ويركّز على الإعلان", async () => {
    const memory = createChatMemory(memoryRedis());
    for (let i = 1; i <= 24; i += 1) {
      await memory.append("store-1", "user-1", { role: i % 2 ? "user" : "assistant", text: `رسالة ${i}` });
    }
    const history = await memory.history("store-1", "user-1");
    expect(history).toHaveLength(20);
    expect(history[0]?.text).toBe("رسالة 5");
    expect(history.at(-1)?.text).toBe("رسالة 24");
    await memory.setFocus("store-1", "user-1", "A001");
    await expect(memory.getFocus("store-1", "user-1")).resolves.toBe("A001");
  });

  it("لا يكرر نفس الرسالة المتتالية ويسمح بـ reset", async () => {
    const memory = createChatMemory(memoryRedis());
    await memory.append("s", "u", { role: "user", text: "كم إعلان عندي؟" });
    await memory.append("s", "u", { role: "user", text: "كم إعلان عندي؟" });
    await memory.append("s", "u", { role: "assistant", text: "عندك 2." });
    expect(await memory.history("s", "u")).toHaveLength(2);
    await memory.reset("s", "u");
    expect(await memory.history("s", "u")).toHaveLength(0);
    await expect(memory.getFocus("s", "u")).resolves.toBeNull();
  });
});
