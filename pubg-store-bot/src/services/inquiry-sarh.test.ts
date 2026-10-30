import { describe, expect, it, vi } from "vitest";
import { createInquiryService } from "./inquiry";

function make(botUsername: string, status = "SOLD", delivered = true) {
  const listing = { id: "L1", shortCode: "A001", status, storeId: "s1", sellerTelegramId: "111", ownerTelegramId: "999", ownerUsername: "iir8rr" };
  const base: any = {
    store: { findUnique: async () => ({ botUsername }) },
    inquiry: { findFirst: async () => null, create: async () => ({ id: "I1" }), update: async () => ({}) },
    auditLog: { create: async () => ({}) },
    referral: { upsert: async () => ({}), findFirst: async () => null, create: async () => ({}) },
    $transaction: async (f: any) => f(db),
  };
  const stub = () => new Proxy({}, { get: () => async () => ({}) });
  const db: any = new Proxy(base, { get: (t, k) => (k in t ? t[k] : stub()) });
  void {
    storeMember: { upsert: async () => ({}), findUnique: async () => null }, referralEvent: { create: async () => ({}) },
  };
  const n: any = new Proxy({ askSeller: vi.fn(async () => delivered), resolveParty: async () => ({}), tellOwnerSellerUnreachable: vi.fn(async () => undefined) }, { get: (t, k) => (k in t ? (t as any)[k] : vi.fn(async () => undefined)) });
  const listings: any = { getInquiryByShortCode: async () => listing };
  const svc = createInquiryService(db, listings, n, { schedule: async () => undefined } as any);
  return { svc, n };
}

describe("sarh buyer inquiry always asks the seller", () => {
  it("SOLD in DB → still asks seller, buyer told to wait", async () => {
    const { svc, n } = make("sarhstoree_bot");
    const r = await svc.openFromBuyer({ buyerTelegramId: "222", shortCode: "A001", storeId: "s1", notifyBuyer: false });
    expect(n.askSeller).toHaveBeenCalledWith("111", "I1", "A001");
    expect(r.outcome).toBe("checking");
    expect(r.buyerMessage).toContain("أتأكد من المعلن");
  });
  it("DMSTOR keeps DB sold reply", async () => {
    const { svc, n } = make("DMSTOR_bot");
    const r = await svc.openFromBuyer({ buyerTelegramId: "222", shortCode: "A001", storeId: "s1", notifyBuyer: false });
    expect(r.outcome).toBe("sold");
    expect(n.askSeller).not.toHaveBeenCalled();
  });
  it("seller unreachable → timeout + owner notified", async () => {
    const { svc, n } = make("sarhstoree_bot", "PUBLISHED", false);
    const r = await svc.openFromBuyer({ buyerTelegramId: "222", shortCode: "A001", storeId: "s1", notifyBuyer: false });
    expect(r.outcome).toBe("timeout");
    expect(n.tellOwnerSellerUnreachable).toHaveBeenCalled();
  });
});
