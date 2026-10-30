import { describe, expect, it } from "vitest";
import { ownerHandlesSales } from "./owner-sales";
import { __test } from "../agent/create";
describe("owner handles sales", () => {
  it("sarh only", () => {
    expect(ownerHandlesSales("sarhstoree_bot")).toBe(true);
    expect(ownerHandlesSales("@SarhStoree_bot")).toBe(true);
    expect(ownerHandlesSales("DMSTOR_bot")).toBe(false);
    expect(ownerHandlesSales("Sultan_SL_Bot")).toBe(false);
  });
  it("agent createInquiry gate detects sarh store", async () => {
    const db = { store: { findUnique: async () => ({ botUsername: "sarhstoree_bot" }) } };
    expect(await __test.isOwnerHandlesSalesStore(db, "s")).toBe(true);
    const db2 = { store: { findUnique: async () => ({ botUsername: "DMSTOR_bot" }) } };
    expect(await __test.isOwnerHandlesSalesStore(db2, "s")).toBe(false);
  });
});
