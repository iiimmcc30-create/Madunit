import { describe, expect, it } from "vitest";
import { EVAL_CORPUS } from "./corpus";
import {
  BUYER_MULTI_TURN,
  OWNER_MULTI_TURN,
  OWNER_STUCK_DRAFT,
  PREVIOUS_OWNER_FAILURES_AS_BUYER,
  SELLER_MULTI_TURN,
  SUPER_ADMIN_MULTI_TURN,
} from "./conversations";
import { evaluateCase, evaluateConversation, evaluateCorpus, estimateConversationCostUsd } from "./score";

function failSample(report: { failed: { id: string; expected: string; actual: string; text: string }[] }) {
  return report.failed.map((row) => `${row.id}: expected ${row.expected} got ${row.actual} «${row.text}»`).join("\n");
}

describe("تقييم فهم المحادثة", () => {
  it("كوربس الرسالة الواحدة يغطي 80 حالة — هذا تقييم heuristic وليس جودة LLM الحي", () => {
    const report = evaluateCorpus(EVAL_CORPUS);
    expect(report.total).toBeGreaterThanOrEqual(80);
    if (report.pct < 80) {
      throw new Error(`نسبة الفهم ${report.pct}% (${report.passed}/${report.total})\n${failSample(report)}`);
    }
    expect(report.pct).toBeGreaterThanOrEqual(80);
    expect(report.pct).toBeLessThan(100);
  });

  it("محادثة المالك متعددة الرسائل (سياق متتالٍ) تنجح", () => {
    const report = evaluateConversation(OWNER_MULTI_TURN);
    expect(failSample(report) || "ok").toBe("ok");
    expect(report.pct).toBe(100);
    expect(report.total).toBe(OWNER_MULTI_TURN.length);
  });

  it("مسودة إعلان عالقة لا تسرق أسئلة إدارة المالك", () => {
    const report = evaluateConversation(OWNER_STUCK_DRAFT);
    expect(failSample(report) || "ok").toBe("ok");
    expect(report.pct).toBe(100);
  });

  it("محادثة مشتري وبائع متعددة الرسائل", () => {
    const buyer = evaluateConversation(BUYER_MULTI_TURN);
    const seller = evaluateConversation(SELLER_MULTI_TURN);
    const admin = evaluateConversation(SUPER_ADMIN_MULTI_TURN);
    expect(failSample(buyer) || "ok").toBe("ok");
    expect(failSample(seller) || "ok").toBe("ok");
    expect(failSample(admin) || "ok").toBe("ok");
  });

  it("نفس جمل المالك تفشل إذا عومل كمشترٍ — هذا كان الفشل الحقيقي قبل إصلاح الدور", () => {
    const report = evaluateConversation(PREVIOUS_OWNER_FAILURES_AS_BUYER);
    expect(report.passed).toBe(0);
    expect(report.failed.length).toBe(PREVIOUS_OWNER_FAILURES_AS_BUYER.length);
    expect(evaluateCase({ id: "fix", text: "كم إعلان عندي؟", expect: "list_store_listings", role: "owner" }).ok).toBe(
      true,
    );
  });

  it("يقدّر تكلفة المحادثة للنموذج الرئيسي", () => {
    expect(estimateConversationCostUsd()).toBeGreaterThan(0.01);
    expect(estimateConversationCostUsd()).toBeLessThan(0.1);
  });
});
