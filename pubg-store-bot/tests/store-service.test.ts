import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { ConflictError } from "../src/domain/errors";
import { createStore, ensureDefaultStore, isPrivilegedOwner } from "../src/services/store";

function createStoreDb() {
  const stores = new Map<string, Record<string, unknown>>();
  const audits: unknown[] = [];
  const db = {
    store: {
      findUnique: async ({ where }: { where: { channelId?: string; id?: string } }) => {
        const row = [...stores.values()].find(
          (item) => item.channelId === where.channelId || item.id === where.id,
        );
        return row ?? null;
      },
      findMany: async () => [...stores.values()],
      count: async ({ where }: { where: { ownerTelegramId: string } }) =>
        [...stores.values()].filter((item) => item.ownerTelegramId === where.ownerTelegramId).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `store-${stores.size + 1}`,
          listingSeq: 0,
          paymentInstructions: "",
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          listingFee: new Prisma.Decimal(Number(data.listingFee ?? 0)),
        };
        stores.set(row.id as string, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = stores.get(where.id);
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
  return { db, stores, audits };
}

const config = loadConfig({
  BOT_TOKEN: "123:abc",
  DATABASE_URL: "postgresql://x",
  DEFAULT_CHANNEL_ID: "-1001",
  OWNER_TELEGRAM_ID: "owner-1",
  OWNER_USERNAME: "shop_owner",
  LISTING_FEE: "15",
});

describe("store service", () => {
  it("creates the default store once and keeps later settings", async () => {
    const { db, stores } = createStoreDb();
    const first = await ensureDefaultStore(db as never, config);
    expect(first.listingFee).toBe(15);
    expect(first.coverEnabled).toBe(false);
    const row = [...stores.values()][0];
    row.listingFee = new Prisma.Decimal(0);
    const second = await ensureDefaultStore(db as never, config);
    expect(second.listingFee).toBe(0);
  });

  it("lets the owner add another channel and rejects duplicates", async () => {
    const { db } = createStoreDb();
    await ensureDefaultStore(db as never, config);
    const extra = await createStore(db as never, {
      actorTelegramId: "owner-1",
      envOwnerId: "owner-1",
      channelId: "-1002",
      title: "قناة 2",
      ownerUsername: "shop_owner",
      listingFee: 0,
      publishMode: "AUTO",
    });
    expect(extra.title).toBe("قناة 2");
    expect(extra.coverEnabled).toBe(false);
    expect(extra.subscriptionStatus).toBe("TRIAL");
    await expect(
      createStore(db as never, {
        actorTelegramId: "owner-1",
        envOwnerId: "owner-1",
        channelId: "-1002",
        title: "مكرر",
        ownerUsername: "shop_owner",
        listingFee: 0,
        publishMode: "AUTO",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await isPrivilegedOwner(db as never, config, "owner-1")).toBe(true);
    expect(await isPrivilegedOwner(db as never, config, "stranger")).toBe(false);
  });
});
