import { describe, expect, it } from "vitest";
import { AppError, ForbiddenError } from "../src/domain/errors";
import { assertSellerActive, banSeller, bindSellerToStore, unbanSeller } from "../src/services/seller";

function createSellerDb() {
  const sellers = new Map<string, Record<string, unknown>>();
  const audits: unknown[] = [];
  const db = {
    seller: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { telegramId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = [...sellers.values()].find((row) => row.telegramId === where.telegramId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `seller-${sellers.size + 1}`, status: "ACTIVE", ...create };
        sellers.set(row.id as string, row);
        return row;
      },
      findUnique: async ({ where }: { where: { telegramId: string } }) =>
        [...sellers.values()].find((row) => row.telegramId === where.telegramId) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = sellers.get(where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { db, sellers, audits };
}

describe("seller store bind", () => {
  it("remembers the store from a private invite link", async () => {
    const { db } = createSellerDb();
    const bound = await bindSellerToStore(db as never, "seller-99", "store-7");
    expect(bound.homeStoreId).toBe("store-7");
    const again = await assertSellerActive(db as never, "seller-99");
    expect(again.homeStoreId).toBe("store-7");
  });
});

describe("seller blacklist", () => {
  it("bans a seller so they cannot list, then unbans them", async () => {
    const { db, audits } = createSellerDb();
    await banSeller(db as never, {
      actorTelegramId: "owner-1",
      ownerTelegramId: "owner-1",
      targetTelegramId: "seller-99",
      reason: "تكرار",
    });
    await expect(assertSellerActive(db as never, "seller-99")).rejects.toMatchObject({
      code: "BANNED",
    });
    await unbanSeller(db as never, {
      actorTelegramId: "owner-1",
      ownerTelegramId: "owner-1",
      targetTelegramId: "seller-99",
    });
    const active = await assertSellerActive(db as never, "seller-99");
    expect(active.status).toBe("ACTIVE");
    expect(audits.map((item) => (item as { action: string }).action)).toEqual([
      "seller.ban",
      "seller.unban",
    ]);
  });

  it("rejects a ban from a non-owner", async () => {
    const { db } = createSellerDb();
    await expect(
      banSeller(db as never, {
        actorTelegramId: "stranger",
        ownerTelegramId: "owner-1",
        targetTelegramId: "seller-99",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not allow banning the owner", async () => {
    const { db } = createSellerDb();
    await expect(
      banSeller(db as never, {
        actorTelegramId: "owner-1",
        ownerTelegramId: "owner-1",
        targetTelegramId: "owner-1",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
