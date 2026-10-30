import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LISTING_TEMPLATE } from "../src/domain/caption";
import { AppError, ConflictError, ForbiddenError } from "../src/domain/errors";
import { buildListingCaption, createListingService } from "../src/services/listing";
import type { ChannelPublisher } from "../src/infra/publisher";

function createMemDb() {
  const store = {
    id: "store-1",
    channelId: "-1001",
    ownerUsername: "shop_owner",
    ownerTelegramId: "owner-1",
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
  const listings = new Map<string, Record<string, unknown>>();
  const audits: unknown[] = [];
  const sellers = new Map<string, { id: string; listingCount: number }>();

  const db = {
    store: {
      update: async () => {
        store.listingSeq += 1;
        return { ...store };
      },
    },
    listing: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
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
      count: async ({
        where,
      }: {
        where: { sellerId: string; status: { not: string }; createdAt: { gte: Date } };
      }) =>
        [...listings.values()].filter(
          (item) =>
            item.sellerId === where.sellerId &&
            item.status !== where.status.not &&
            (item.createdAt as Date) >= where.createdAt.gte,
        ).length,
      findFirst: async ({
        where,
      }: {
        where: {
          shortCode?: string;
          storeId?: string;
          status?: string;
          id?: { not: string };
          OR?: Array<{ fingerprint?: { in: string[] }; fingerprints?: { hasSome: string[] } }>;
        };
      }) => {
        if (where.shortCode) {
          const row = [...listings.values()].find((item) => item.shortCode === where.shortCode);
          return row ? { ...row, store } : null;
        }
        const strong = [
          ...new Set(
            (where.OR ?? []).flatMap((clause) => clause.fingerprint?.in ?? clause.fingerprints?.hasSome ?? []),
          ),
        ];
        const row = [...listings.values()].find((item) => {
          if (where.storeId && item.storeId !== where.storeId) return false;
          if (where.status && item.status !== where.status) return false;
          if (where.id?.not && item.id === where.id.not) return false;
          if (strong.length === 0) return true;
          const keys = [
            item.fingerprint as string | null,
            ...((item.fingerprints as string[] | undefined) ?? []),
          ].filter(Boolean);
          return keys.some((key) => strong.includes(key as string));
        });
        return row ? { ...row, store } : null;
      },
      findUnique: async ({
        where,
      }: {
        where: { id?: string; shortCode?: string; storeId_shortCode?: { storeId: string; shortCode: string } };
      }) => {
        const row = [...listings.values()].find((item) => {
          if (where.id && item.id === where.id) return true;
          if (where.shortCode && item.shortCode === where.shortCode) return true;
          if (
            where.storeId_shortCode &&
            item.storeId === where.storeId_shortCode.storeId &&
            item.shortCode === where.storeId_shortCode.shortCode
          ) {
            return true;
          }
          return false;
        });
        return row ? { ...row, store } : null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = listings.get(where.id);
        if (!row) return null;
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row, store };
      },
    },
    seller: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { listingCount?: { increment: number } };
      }) => {
        const current = sellers.get(where.id) ?? { id: where.id, listingCount: 0 };
        current.listingCount += data.listingCount?.increment ?? 0;
        sellers.set(where.id, current);
        return current;
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        audits.push(data);
        return data;
      },
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  };

  return { db, store, listings, sellers, audits };
}

function createPublisher(): ChannelPublisher {
  return {
    sendVideo: vi.fn(async () => ({ messageId: 77 })),
    sendListing: vi.fn(async (_channel, input) => ({
      messageId: 77,
      caption: input.caption,
    })),
    editCaption: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
  };
}

const draftInput = {
  storeId: "store-1",
  sellerId: "seller-secret",
  sellerTelegramId: "888777666",
  videoFileId: "file-1",
  videoUniqueId: "uniq-1",
  description: "لفل 60 سكن نادر تواصل @hidden_seller",
  price: 180,
  binding: "جوجل",
};

describe("listing service", () => {
  it("creates a short code and publishes without seller traces", async () => {
    const { db, sellers, audits } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);

    const draft = await listings.saveDraft(draftInput);
    expect(draft.shortCode).toBe("A001");
    expect(draft.status).toBe("DRAFT");
    expect(draft.fingerprint).toBe("video:uniq-1");

    const published = await listings.publish(draft.id, draftInput.sellerTelegramId);
    expect(published.status).toBe("PUBLISHED");
    expect(published.channelMessageId).toBe("77");
    expect(sellers.get("seller-secret")?.listingCount).toBe(1);

    const sent = vi.mocked(publisher.sendListing).mock.calls[0][1];
    const sentCaption = sent.caption;
    expect(sent.replyMarkup).toBeUndefined();
    expect(sent).not.toHaveProperty("coverPng");
    expect(sentCaption).toContain("@shop_owner");
    expect(sentCaption).toContain("A001");
    expect(sentCaption).toContain("180");
    expect(sentCaption).not.toContain("hidden_seller");
    expect(sentCaption).not.toContain("seller-secret");
    expect(sentCaption).not.toContain("888777666");
    expect(audits.some((item) => (item as { action: string }).action === "listing.publish")).toBe(
      true,
    );
  });

  it("lets only the owner mark a listing sold and edits the channel caption", async () => {
    const { db } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);
    const draft = await listings.saveDraft(draftInput);
    await listings.publish(draft.id);

    await expect(listings.markSold("A001", "stranger")).rejects.toBeInstanceOf(ForbiddenError);

    const sold = await listings.markSold("a1", "owner-1");
    expect(sold.status).toBe("SOLD");
    expect(publisher.editCaption).toHaveBeenCalledOnce();
    const caption = vi.mocked(publisher.editCaption).mock.calls[0][2];
    expect(caption.startsWith("تم البيع ✅")).toBe(true);
    expect(caption).not.toContain("hidden_seller");
  });

  it("lets only the owner delete a listing from the channel", async () => {
    const { db } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);
    const draft = await listings.saveDraft(draftInput);
    await listings.publish(draft.id);

    await expect(listings.deleteListing("A001", "stranger")).rejects.toBeInstanceOf(ForbiddenError);

    const deleted = await listings.deleteListing("A001", "owner-1");
    expect(deleted.status).toBe("DELETED");
    expect(publisher.deleteMessage).toHaveBeenCalledWith("-1001", 77);
  });

  it("attaches an inquiry deep link under the channel post", async () => {
    const { db } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher, {
      dailyListingLimit: 10,
      botUsername: "demo_bot",
    });
    const draft = await listings.saveDraft(draftInput);
    await listings.publish(draft.id, draftInput.sellerTelegramId);
    const markup = vi.mocked(publisher.sendListing).mock.calls[0][1].replyMarkup;
    const json = JSON.stringify(markup);
    expect(json).toContain("استفسار");
    expect(json).toContain("https://t.me/demo_bot?start=ask_A001");
  });

  it("publishes immediately when the listing fee is zero", async () => {
    const { db } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);
    const draft = await listings.saveDraft(draftInput);
    const published = await listings.requestPublish(draft.id, draftInput.sellerTelegramId);
    expect(published.status).toBe("PUBLISHED");
    expect(publisher.sendListing).toHaveBeenCalledOnce();
    expect(vi.mocked(publisher.sendListing).mock.calls[0][1]).not.toHaveProperty("coverPng");
  });

  it("waits for a receipt when the store charges a listing fee", async () => {
    const { db, store } = createMemDb();
    store.listingFee = new Prisma.Decimal(15);
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);
    const draft = await listings.saveDraft(draftInput);
    const pending = await listings.requestPublish(draft.id, draftInput.sellerTelegramId);
    expect(pending.status).toBe("PENDING_PAYMENT");
    expect(pending.listingFee).toBe(15);
    expect(publisher.sendListing).not.toHaveBeenCalled();

    const cancelled = await listings.cancel(draft.id, draftInput.sellerTelegramId);
    expect(cancelled.status).toBe("DELETED");
  });

  it("updates the live price instead of publishing a duplicate for the same seller", async () => {
    const { db, listings: rows, audits } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);
    const first = await listings.saveDraft(draftInput);
    await listings.publish(first.id, draftInput.sellerTelegramId);

    const second = await listings.saveDraft({ ...draftInput, price: 220 });
    const updated = await listings.requestPublish(second.id, draftInput.sellerTelegramId);
    expect(updated.id).toBe(first.id);
    expect(updated.shortCode).toBe("A001");
    expect(updated.price).toBe(220);
    expect(rows.get(second.id)?.status).toBe("DELETED");
    expect(publisher.sendListing).toHaveBeenCalledOnce();
    expect(publisher.editCaption).toHaveBeenCalledOnce();
    expect(
      audits.some((item) => (item as { action: string }).action === "listing.duplicate_update"),
    ).toBe(true);
  });

  it("blocks another seller from publishing the same account", async () => {
    const { db } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);
    const first = await listings.saveDraft(draftInput);
    await listings.publish(first.id);

    const other = await listings.saveDraft({
      ...draftInput,
      sellerId: "seller-other",
      sellerTelegramId: "111",
    });
    await expect(listings.requestPublish(other.id, "111")).rejects.toBeInstanceOf(ConflictError);
    expect(publisher.sendListing).toHaveBeenCalledOnce();
  });

  it("blocks publish when the store subscription expired", async () => {
    const { db, store } = createMemDb();
    store.subscriptionStatus = "EXPIRED";
    store.subscriptionExpiresAt = new Date("2020-01-01T00:00:00.000Z");
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher);
    const draft = await listings.saveDraft(draftInput);
    await expect(listings.publish(draft.id, draftInput.sellerTelegramId)).rejects.toMatchObject({
      code: "STORE_STOPPED",
    });
    expect(publisher.sendListing).not.toHaveBeenCalled();
  });

  it("enforces a daily listing cap per seller", async () => {
    const { db } = createMemDb();
    const publisher = createPublisher();
    const listings = createListingService(db as never, publisher, {
      dailyListingLimit: 1,
    });
    await listings.saveDraft(draftInput);
    await expect(listings.saveDraft({ ...draftInput, videoUniqueId: "uniq-2" })).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe("buildListingCaption", () => {
  it("never leaks seller identifiers", () => {
    const caption = buildListingCaption({
      id: "listing-1",
      storeId: "store-1",
      shortCode: "A042",
      sellerId: "seller-secret-id",
      telegramVideoFileId: "file",
      description: "حساب مرتب كلم @the_seller",
      binding: "فيس",
      price: 90,
      status: "PUBLISHED",
      channelMessageId: "1",
      ownerUsername: "shop_owner",
      listingTemplate: DEFAULT_LISTING_TEMPLATE,
      channelId: "-1001",
      fingerprint: "video:uniq",
      listingFee: 0,
      fingerprints: ["video:uniq"],
      extractedFields: {},
    });

    expect(caption).toContain("@shop_owner");
    expect(caption).toContain("A042");
    expect(caption).not.toContain("the_seller");
    expect(caption).not.toContain("seller-secret-id");
  });
});
