import { describe, expect, it } from "vitest";
import { countReferrals, trackReferral } from "../src/services/referral";

function createReferralDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    storeReferral: {
      upsert: async ({
        where,
        create,
      }: {
        where: { storeId_telegramId_role: { storeId: string; telegramId: string; role: string } };
        create: Record<string, unknown>;
      }) => {
        const key = where.storeId_telegramId_role;
        const existing = rows.find(
          (row) =>
            row.storeId === key.storeId &&
            row.telegramId === key.telegramId &&
            row.role === key.role,
        );
        if (existing) return existing;
        const row = { id: `ref-${rows.length + 1}`, ...create };
        rows.push(row);
        return row;
      },
      count: async ({ where }: { where: { storeId: string; role: string } }) =>
        rows.filter((row) => row.storeId === where.storeId && row.role === where.role).length,
    },
  };
  return { db, rows };
}

describe("referrals", () => {
  it("counts unique sellers and buyers per store", async () => {
    const { db } = createReferralDb();
    await trackReferral(db as never, {
      storeId: "store-1",
      telegramId: "s1",
      role: "SELLER",
      source: "store_store-1",
    });
    await trackReferral(db as never, {
      storeId: "store-1",
      telegramId: "s1",
      role: "SELLER",
      source: "store_store-1",
    });
    await trackReferral(db as never, {
      storeId: "store-1",
      telegramId: "b1",
      role: "BUYER",
      source: "ask_A001",
    });
    await trackReferral(db as never, {
      storeId: "store-2",
      telegramId: "b1",
      role: "BUYER",
      source: "ask_A002",
    });

    await expect(countReferrals(db as never, "store-1")).resolves.toEqual({
      sellers: 1,
      buyers: 1,
    });
    await expect(countReferrals(db as never, "store-2")).resolves.toEqual({
      sellers: 0,
      buyers: 1,
    });
  });
});
