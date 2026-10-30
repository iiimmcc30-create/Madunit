import { describe, expect, it } from "vitest";
import { classifyAdminIntent, parseAdminIntentJson } from "./admin-intent";

const kind = (text: string) => classifyAdminIntent(text).kind;

describe("classifyAdminIntent", () => {
  it("maps add-bot requests", () => {
    expect(kind("ضيف بوت")).toBe("add_bot");
    expect(kind("ابي اربط بوت جديد")).toBe("add_bot");
    expect(kind("أبغى أضيف متجر")).toBe("add_bot");
    expect(kind("عندي توكن")).toBe("add_bot");
  });
  it("maps store listing and status", () => {
    expect(kind("كم متجر عندي")).toBe("list_stores");
    expect(kind("ورني المتاجر")).toBe("list_stores");
    expect(kind("وش حالة البوتات")).toBe("status");
    expect(kind("البوتات شغالة؟")).toBe("status");
    expect(kind("الإحصائيات")).toBe("stats");
  });
  it("maps store actions with targets", () => {
    expect(classifyAdminIntent("وقف متجر @Aramstoree_bot")).toEqual({ kind: "disable_store", target: "Aramstoree_bot" });
    expect(kind("وقف متجر ارام")).toBe("disable_store");
    expect(classifyAdminIntent("وقف متجر ارام").target).toBe("ارام");
    expect(kind("شغل متجر Bootpubg_bot")).toBe("enable_store");
    expect(kind("احذف بوت @x_bot")).toBe("delete_store");
  });
  it("maps channel, subscriptions, scrim", () => {
    expect(kind("فك ربط القناة")).toBe("unbind_channel");
    expect(kind("افصل القناة عن متجر ارام")).toBe("unbind_channel");
    expect(kind("اربط قناة")).toBe("bind_channel");
    expect(kind("الإيصالات")).toBe("subscriptions");
    expect(kind("مدد اشتراك متجر ارام 30 يوم")).toBe("extend");
    expect(kind("اربط بوت سكرم")).toBe("scrim_link");
  });
  it("detects ad creation and help", () => {
    expect(kind("ابي انشر اعلان")).toBe("create_ad");
    expect(kind("أبي أبيع حساب")).toBe("create_ad");
    expect(kind("مساعدة")).toBe("help");
    expect(kind("هلا والله")).toBe("unknown");
  });
  it("parses LLM json safely", () => {
    expect(parseAdminIntentJson('{"kind":"add_bot"}')).toEqual({ kind: "add_bot" });
    expect(parseAdminIntentJson('ok {"kind":"disable_store","target":"@a_bot"}')).toEqual({ kind: "disable_store", target: "a_bot" });
    expect(parseAdminIntentJson('{"kind":"rm -rf"}')).toEqual({ kind: "unknown" });
    expect(parseAdminIntentJson("garbage")).toEqual({ kind: "unknown" });
  });
});
