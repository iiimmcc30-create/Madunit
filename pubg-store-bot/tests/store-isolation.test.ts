import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LISTING_TEMPLATE } from "../src/domain/caption";
import { createListingService } from "../src/services/listing";
import type { ChannelPublisher } from "../src/infra/publisher";

function makeStore(id: string, channelId: string, ownerTelegramId: string) {
  return {
    id,
    channelId,
    ownerUsername: id === "store-a" ? "shopa" : "shopb",
    ownerTelegramId,
    listingTemplate: DEFAULT_LISTING_TEMPLATE,
    listingFee: new Prisma.Decimal(0),
    paymentInstructions: "",
    coverTheme: {},
    coverEnabled: false,
    publishMode: "AUTO" as const,
    listingSeq: 0,
    botEnabled: true,
    subscriptionStatus: "TRIAL" as const,
    subscriptionExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createTwoStoreDb() {
  const stores = new Map([
    ["store-a", makeStore("store-a", "-1001", "owner-a")],
    ["store-b", makeStore("store-b", "-1002", "owner-b")],
  ]);
  const listings = new Map<string, Record<string, unknown>>();
  const db = {
    store: {
      update: async ({ where }: { where: { id: string } }) => {
        const store = stores.get(where.id);
        if (!store) throw new Error("missing store");
        store.listingSeq += 1;
        return { ...store };
      },
    },
    listing: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const store = stores.get(data.storeId as string)!;
        const row = {
          id: `listing-${listings.size + 1}`,
          channelMessageId: null,
          fingerprints: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        listings.set(row.id as string, row);
        return { ...row, store };
      },
      count: async () => 0,
      findFirst: async () => null,
      findUnique: async ({
        where,
      }: {
        where: { id?: string; storeId_shortCode?: { storeId: string; shortCode: string } };
      }) => {
        const row = [...listings.values()].find((item) => {
          if (where.id) return item.id === where.id;
          if (where.storeId_shortCode) {
            return (
              item.storeId === where.storeId_shortCode.storeId &&
              item.shortCode === where.storeId_shortCode.shortCode
            );
          }
          return false;
        });
        if (!row) return null;
        return { ...row, store: stores.get(row.storeId as string), seller: { id: row.sellerId, telegramId: "x" } };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = listings.get(where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row, store: stores.get(row.storeId as string) };
      },
    },
    seller: {
      update: async ({ where }: { where: { id: string } }) => ({ id: where.id, listingCount: 1 }),
    },
    auditLog: { create: async () => ({}) },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  };
  return { db, listings, stores };
}

function publisher(): ChannelPublisher {
  return {
    sendVideo: vi.fn(async () => ({ messageId: 1 })),
    sendListing: vi.fn(async () => ({ messageId: 10 })),
    editCaption: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
  };
}

describe("store listing isolation", () => {
  it("allows the same short code on two stores and sold only hits one", async () => {
    const { db } = createTwoStoreDb();
    const listings = createListingService(db as never, publisher());
    const a = await listings.saveDraft({
      storeId: "store-a",
      sellerId: "seller-a",
      sellerTelegramId: "1",
      videoFileId: "va",
      description: "حساب أ",
      price: 100,
      binding: "جوجل",
    });
    const b = await listings.saveDraft({
      storeId: "store-b",
      sellerId: "seller-b",
      sellerTelegramId: "2",
      videoFileId: "vb",
      description: "حساب ب",
      price: 200,
      binding: "فيس",
    });
    expect(a.shortCode).toBe("A001");
    expect(b.shortCode).toBe("A001");
    await listings.publish(a.id, "1");
    await listings.publish(b.id, "2");

    const sold = await listings.markSold("A001", "owner-a", "store-a");
    expect(sold.storeId).toBe("store-a");
    expect(sold.status).toBe("SOLD");

    const still = await listings.getByShortCode("A001", "store-b");
    expect(still.status).toBe("PUBLISHED");
    expect(still.price).toBe(200);
  });
});
