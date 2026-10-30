import { describe, expect, it } from "vitest";
import { loadGlobalGlossary } from "../domain/glossary";
import { buildAgentSystemPrompt } from "./prompt";

describe("تعليمات النظام حسب الدور", () => {
  it("يصرّح أن المتحدث مالك وليس عميلًا ويمرر ملخص المتجر", () => {
    const prompt = buildAgentSystemPrompt({
      storeTitle: "قناة آرام",
      ownerUsername: "cv_91",
      glossary: loadGlobalGlossary(),
      role: "owner",
      snapshot: { title: "قناة آرام", channelId: "-1002640903520", publishedListings: 4, waitingInquiries: 1 },
    });
    expect(prompt).toContain("مالك هذا المتجر");
    expect(prompt).toContain("وليس عميلًا");
    expect(prompt).toContain("لا تعرض عليه مسار «تبي تعرض حساب؟»");
    expect(prompt).toContain("list_store_listings");
    expect(prompt).toContain("إعلانات نشطة/منشورة 4");
    expect(prompt).toContain("استفسارات معلّقة 1");
    expect(prompt).toContain("-1002640903520");
  });

  it("تعليمات المشتري لا تُستخدم للمالك", () => {
    const buyer = buildAgentSystemPrompt({
      storeTitle: "قناة آرام",
      ownerUsername: "cv_91",
      glossary: loadGlobalGlossary(),
      role: "buyer",
    });
    expect(buyer).toContain("عميل/مشتري");
    expect(buyer).not.toContain("list_store_listings");
  });
});
