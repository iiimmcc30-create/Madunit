import { describe, expect, it } from "vitest";
import { executeToolCall } from "./execute";
import type { AgentToolRuntime } from "./tools";

function runtime(role: AgentToolRuntime["role"] = "buyer"): AgentToolRuntime {
  return {
    ownerUsername: "cv_91",
    role,
    confirmed: false,
    media: {},
    draft: { videoFileId: "vid", price: 90 },
    lastSearchCodes: ["A001"],
    longTermSummary: "",
    focusShortCode: "A001",
    async setFocus() {},
    async searchListings() {
      return [];
    },
    async getListing() {
      return null;
    },
    async createInquiry() {
      return { listing: null, outcome: "not_found", buyerMessage: "ما لقيت." };
    },
    async saveBuyerRequest() {
      return { ok: true, message: "تم." };
    },
  };
}

describe("تنفيذ الأدوات", () => {
  it("يرفض نشر المشتري ويطلب تأكيد البائع", async () => {
    const denied = await executeToolCall({ id: "1", name: "publish_listing", arguments: {} }, runtime("buyer"));
    expect(JSON.parse(denied.json).error).toMatch(/بائع|صلاحية/);
    const confirm = await executeToolCall({ id: "2", name: "publish_listing", arguments: {} }, runtime("seller"));
    expect(confirm.pendingConfirm?.tool).toBe("publish_listing");
    expect(confirm.finalText).toMatch(/نأكد/);
  });
});
