import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LISTING_TEMPLATE } from "../src/domain/caption";
import { AppError, NotFoundError } from "../src/domain/errors";
import { texts } from "../src/bot/texts";
import type { InquiryJobs } from "../src/infra/queue";
import type { InquiryNotifier, PartyInfo } from "../src/infra/notify";
import { createInquiryService } from "../src/services/inquiry";
import type { InquiryListingView, ListingService } from "../src/services/listing";

const listing: InquiryListingView = {
  id: "listing-1",
  storeId: "store-1",
  shortCode: "A001",
  description: "لفل 60 سكن نادر",
  price: 180,
  binding: "جوجل",
  ownerUsername: "shop_owner",
  listingTemplate: DEFAULT_LISTING_TEMPLATE,
  status: "PUBLISHED",
  telegramVideoFileId: "file-1",
  channelId: "-1001",
  channelMessageId: "77",
  sellerId: "seller-row",
  fingerprint: "video:uniq",
  fingerprints: ["video:uniq"],
  sellerTelegramId: "seller-99",
  ownerTelegramId: "owner-1",
  listingFee: 0,
  extractedFields: {},
};

function createInquiryDb(view: InquiryListingView = listing) {
  const rows: Array<Record<string, unknown>> = [];
  const audits: unknown[] = [];
  const referrals: unknown[] = [];

  const nestedListing = {
    id: view.id,
    storeId: view.storeId,
    shortCode: view.shortCode,
    description: view.description,
    seller: { telegramId: view.sellerTelegramId },
    store: {
      ownerUsername: view.ownerUsername,
      ownerTelegramId: view.ownerTelegramId,
    },
  };

  const db = {
    inquiry: {
      findFirst: async ({
        where,
      }: {
        where: { listingId: string; buyerTelegramId: string; status: string };
      }) =>
        rows.find(
          (row) =>
            row.listingId === where.listingId &&
            row.buyerTelegramId === where.buyerTelegramId &&
            row.status === where.status,
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `inq-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = rows.find((item) => item.id === where.id);
        return row ? { ...row, listing: nestedListing } : null;
      },
      findMany: async ({
        where,
      }: {
        where: { listingId: string; status: string; id?: { not: string } };
      }) =>
        rows
          .filter((row) => {
            if (row.listingId !== where.listingId || row.status !== where.status) return false;
            if (where.id?.not && row.id === where.id.not) return false;
            return true;
          })
          .map((row) => ({ ...row, listing: nestedListing })),
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return { ...row, listing: nestedListing };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find((item) => item.id === where.id && item.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        audits.push(data);
        return data;
      },
    },
    storeReferral: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        referrals.push(create);
        return { id: `ref-${referrals.length}`, ...create };
      },
    },
  };

  return { db, rows, audits, referrals };
}

function createNotifier(): InquiryNotifier {
  return {
    askSeller: vi.fn(async () => true),
    remindSeller: vi.fn(async () => undefined),
    tellBuyerChecking: vi.fn(async () => undefined),
    tellBuyerAvailable: vi.fn(async () => undefined),
    tellBuyerSold: vi.fn(async () => undefined),
    tellBuyerTimeout: vi.fn(async () => undefined),
    tellBuyerAlreadyWaiting: vi.fn(async () => undefined),
    tellBuyerOwnListing: vi.fn(async () => undefined),
    tellBuyerNotPublished: vi.fn(async () => undefined),
    tellBuyerListingMatch: vi.fn(async () => undefined),
    tellOwnerAvailable: vi.fn(async () => undefined),
    tellOwnerTimeout: vi.fn(async () => undefined),
    tellOwnerSellerUnreachable: vi.fn(async () => undefined),
    tellSellerPricePrompt: vi.fn(async () => undefined),
    tellSellerAck: vi.fn(async () => undefined),
    resolveParty: vi.fn(async (telegramId: string): Promise<PartyInfo> => ({ telegramId })),
  };
}

function createJobs(): InquiryJobs {
  return {
    schedule: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

function createListings(view: InquiryListingView = listing): ListingService {
  return {
    getInquiryByShortCode: vi.fn(async (code: string) => {
      if (code !== view.shortCode) {
        throw new NotFoundError("Listing", code, "missing");
      }
      return view;
    }),
    getInquiryByChannelMessage: vi.fn(async (channelId: string, messageId: number) => {
      if (channelId === view.channelId && String(messageId) === view.channelMessageId) {
        return view;
      }
      return null;
    }),
    markSoldAsSystem: vi.fn(async () => ({ ...view, status: "SOLD" as const })),
  } as unknown as ListingService;
}

describe("inquiry service", () => {
  it("asks the seller without revealing the buyer, then reports price only to buyer and owner", async () => {
    const { db, rows, referrals } = createInquiryDb();
    const notifier = createNotifier();
    const jobs = createJobs();
    const inquiries = createInquiryService(db as never, createListings(), notifier, jobs);

    await inquiries.openFromBuyer({ buyerTelegramId: "buyer-1", shortCode: "A001" });
    expect(referrals).toEqual([
      expect.objectContaining({
        storeId: "store-1",
        telegramId: "buyer-1",
        role: "BUYER",
        source: "A001",
      }),
    ]);

    expect(notifier.askSeller).toHaveBeenCalledWith("seller-99", "inq-1", "A001");
    expect(vi.mocked(notifier.askSeller).mock.calls[0].join(" ")).not.toContain("buyer-1");
    expect(notifier.tellBuyerChecking).toHaveBeenCalledWith("buyer-1", "A001");
    expect(jobs.schedule).toHaveBeenCalledWith("inq-1");

    await inquiries.beginAvailable("inq-1", "seller-99");
    await inquiries.confirmAvailable("inq-1", "seller-99", 175);

    expect(rows[0].status).toBe("AVAILABLE");
    expect(notifier.tellBuyerAvailable).toHaveBeenCalledWith("buyer-1", "A001", 175, "shop_owner");
    const buyerMsg = vi.mocked(notifier.tellBuyerAvailable).mock.calls[0];
    expect(buyerMsg.join(" ")).not.toContain("seller-99");

    const ownerMsg = vi.mocked(notifier.tellOwnerAvailable).mock.calls[0][0];
    expect(ownerMsg.ownerId).toBe("owner-1");
    expect(ownerMsg.buyer.telegramId).toBe("buyer-1");
    expect(ownerMsg.seller.telegramId).toBe("seller-99");
    expect(ownerMsg.price).toBe(175);
    expect(jobs.cancel).toHaveBeenCalledWith("inq-1");
  });

  it("sends the available summary to the listing channel owner, not another store", async () => {
    const other: InquiryListingView = {
      ...listing,
      ownerTelegramId: "channel-owner-55",
      ownerUsername: "other_shop",
      storeId: "store-9",
    };
    const { db } = createInquiryDb(other);
    const notifier = createNotifier();
    const inquiries = createInquiryService(db as never, createListings(other), notifier, createJobs());

    await inquiries.openFromBuyer({ buyerTelegramId: "buyer-1", shortCode: "A001" });
    await inquiries.beginAvailable("inq-1", "seller-99");
    await inquiries.confirmAvailable("inq-1", "seller-99", 200);

    const ownerMsg = vi.mocked(notifier.tellOwnerAvailable).mock.calls[0][0];
    expect(ownerMsg.ownerId).toBe("channel-owner-55");
    expect(ownerMsg.ownerId).not.toBe("owner-1");
  });

  it("marks the listing sold and notifies the buyer when the seller says so", async () => {
    const { db, rows } = createInquiryDb();
    const notifier = createNotifier();
    const jobs = createJobs();
    const listings = createListings();
    const inquiries = createInquiryService(db as never, listings, notifier, jobs);

    await inquiries.openFromBuyer({
      buyerTelegramId: "buyer-1",
      channelId: "-1001",
      channelMessageId: 77,
    });
    await inquiries.confirmSold("inq-1", "seller-99");

    expect(listings.markSoldAsSystem).toHaveBeenCalledWith("A001", "seller-99", "store-1");
    expect(rows[0].status).toBe("SOLD");
    expect(notifier.tellBuyerSold).toHaveBeenCalledWith("buyer-1", "A001", "shop_owner");
    expect(vi.mocked(notifier.tellBuyerSold).mock.calls[0].join(" ")).not.toContain("seller-99");
  });

  it("sends a reminder then times out without introducing the two parties", async () => {
    const { db, rows } = createInquiryDb();
    const notifier = createNotifier();
    const jobs = createJobs();
    const inquiries = createInquiryService(db as never, createListings(), notifier, jobs);

    await inquiries.openFromBuyer({ buyerTelegramId: "buyer-1", shortCode: "A001" });
    await inquiries.remind("inq-1");
    expect(notifier.remindSeller).toHaveBeenCalledWith("seller-99", "inq-1", "A001");
    expect(vi.mocked(notifier.remindSeller).mock.calls[0].join(" ")).not.toContain("buyer-1");

    await inquiries.timeout("inq-1");
    expect(rows[0].status).toBe("TIMEOUT");
    expect(notifier.tellBuyerTimeout).toHaveBeenCalledWith("buyer-1", "A001", "shop_owner");
    expect(notifier.tellOwnerTimeout).toHaveBeenCalledOnce();
    const ownerPayload = vi.mocked(notifier.tellOwnerTimeout).mock.calls[0][0];
    expect(ownerPayload.buyer.telegramId).toBe("buyer-1");
    expect(ownerPayload.seller.telegramId).toBe("seller-99");
  });

  it("lets the agent compose the buyer reply without double-texting", async () => {
    const { db } = createInquiryDb();
    const notifier = createNotifier();
    const inquiries = createInquiryService(db as never, createListings(), notifier, createJobs());
    const result = await inquiries.openFromBuyer({
      buyerTelegramId: "buyer-1",
      shortCode: "A001",
      notifyBuyer: false,
    });
    expect(result.outcome).toBe("checking");
    expect(result.buyerMessage).toContain("A001");
    expect(notifier.askSeller).toHaveBeenCalledOnce();
    expect(notifier.tellBuyerChecking).not.toHaveBeenCalled();
  });

  it("does not let a stranger answer the seller prompt", async () => {
    const { db } = createInquiryDb();
    const inquiries = createInquiryService(
      db as never,
      createListings(),
      createNotifier(),
      createJobs(),
    );
    await inquiries.openFromBuyer({ buyerTelegramId: "buyer-1", shortCode: "A001" });
    await expect(inquiries.confirmSold("inq-1", "stranger")).rejects.toBeInstanceOf(AppError);
  });
});

describe("inquiry copy privacy", () => {
  it("keeps buyer and seller copy free of the other party", () => {
    expect(texts.sellerInquiryAsk("A001")).toContain("A001");
    expect(texts.sellerInquiryAsk("A001")).not.toContain("buyer");
    expect(texts.buyerAvailable("A001", "175")).toContain("175");
    expect(texts.buyerAvailable("A001", "175")).not.toContain("seller");
    expect(texts.buyerAvailable("A001", "175")).not.toContain("shop_owner");
    expect(texts.ownerInquiryAvailable("A001", "175", "buyer-block", "seller-block", "وصف")).toContain(
      "buyer-block",
    );
    expect(texts.ownerInquiryAvailable("A001", "175", "buyer-block", "seller-block", "وصف")).toContain(
      "seller-block",
    );
  });
});
