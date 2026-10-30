import { describe, expect, it } from "vitest";
import { classifyPrivateSellerAd, isPrivateDirectPublishBot } from "./private-direct-publish";

const base = { hasMedia: true, forwarded: false, ownerUsername: "iir8rr", botUsername: "sarhstoree_bot" };
const ad = "حساب ثلجي مثالي 3 فيس ك ربط فيس بوك وتويتر سقوط A5\nالسعر 450\n@trader_x جديد #مكرر";

describe("private direct publish", () => {
  it("only sarhstoree", () => {
    expect(isPrivateDirectPublishBot("sarhstoree_bot")).toBe(true);
    expect(isPrivateDirectPublishBot("DMSTOR_bot")).toBe(false);
    expect(isPrivateDirectPublishBot("Sultan_SL_Bot")).toBe(false);
  });
  it("publishes seller ad", () => {
    expect(classifyPrivateSellerAd({ ...base, caption: ad }).publish).toBe(true);
  });
  it("never publishes buyer lookups", () => {
    for (const c of ["موجود؟", "انباع؟", "تحقق", "فيه؟", "موجود ولا انباع"]) {
      expect(classifyPrivateSellerAd({ ...base, caption: c }).publish).toBe(false);
    }
    expect(classifyPrivateSellerAd({ ...base, caption: ad, forwarded: true }).publish).toBe(false);
    expect(classifyPrivateSellerAd({ ...base, caption: ad + "\nرقم الإعلان: A5" }).publish).toBe(false);
    expect(classifyPrivateSellerAd({ ...base, caption: ad + " @iir8rr" }).publish).toBe(false);
    expect(classifyPrivateSellerAd({ ...base, caption: ad, hasMedia: false }).publish).toBe(false);
  });
});
