import { describe, expect, it } from "vitest";
import { NoopLlmProvider } from "./noop";

describe("NoopLlmProvider", () => {
  const llm = new NoopLlmProvider();

  it("falls back without calling an API", async () => {
    expect(llm.name).toBe("noop");
    const analysis = await llm.analyzeListing("لفل 50 ربط فيس سعر 180 ريال كلم @hidden");
    expect(analysis.fields.level).toBe(50);
    expect(analysis.fields.binding).toBe("فيس");
    expect(analysis.price).toBe(180);
    expect(analysis.description).not.toContain("hidden");
    expect(analysis.strippedContact).toBe(true);
    await expect(llm.detectIntent("A123 موجود؟")).resolves.toBe("availability");
  });
});
