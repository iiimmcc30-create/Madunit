import { describe, expect, it } from "vitest";
import { resolveProviderModel } from "./index";

describe("عزل مزود النموذج", () => {
  it("يحوّل اسم gpt الافتراضي عند التبديل لـ grok أو anthropic", () => {
    expect(resolveProviderModel("openai", "gpt-4o")).toBe("gpt-4o");
    expect(resolveProviderModel("grok", "gpt-4o")).toBe("grok-2-latest");
    expect(resolveProviderModel("anthropic", "gpt-4o")).toBe("claude-sonnet-4-5");
    expect(resolveProviderModel("grok", "grok-3")).toBe("grok-3");
  });
});
