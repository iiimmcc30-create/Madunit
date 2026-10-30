import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent";

describe("classifyIntent", () => {
  it("reads Saudi dialect intents", () => {
    expect(classifyIntent("A123 موجود؟")).toBe("availability");
    expect(classifyIntent("ما انباع A007")).toBe("availability");
    expect(classifyIntent("A123 انباع")).toBe("sold");
    expect(classifyIntent("عندي حساب أبي أعرضه")).toBe("list_account");
    expect(classifyIntent("تقدر ترخص؟")).toBe("price_negotiate");
    expect(classifyIntent("هلا")).toBe("general");
    expect(classifyIntent("عندكم حساب فيه مثالية الثلجي بأقل من 500؟")).toBe("general");
    expect(classifyIntent("وش الفرق بين الربط والإيميل الأول؟")).toBe("general");
  });
});
