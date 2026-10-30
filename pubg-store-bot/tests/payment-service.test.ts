import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ManualReceiptProvider } from "../src/payments/provider";
import { createPaymentService } from "../src/services/payment";
import type { ListingService } from "../src/services/listing";

function createPaymentDb() {
  const listing = {
    id: "listing-1",
    storeId: "store-1",
    shortCode: "A001",
    status: "PENDING_PAYMENT",
    seller: { telegramId: "seller-99" },
    store: { ownerTelegramId: "owner-1", listingFee: new Prisma.Decimal(15) },
  };
  const payments: Array<Record<string, unknown>> = [];
  const audits: unknown[] = [];
  const db = {
    listing: {
      findUnique: async () => listing,
      findFirst: async () => listing,
      update: async ({ data }: { data: { status: string } }) => {
        listing.status = data.status;
        return listing;
      },
    },
    payment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "pay-1", listing, ...data };
        payments.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = payments.find((item) => item.id === where.id);
        return row ? { ...row, listing } : null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = payments.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
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
  return { db, listing, payments };
}

describe("payment service", () => {
  it("requires a receipt only when the fee is above zero", () => {
    const provider = new ManualReceiptProvider();
    expect(provider.requiresReceipt(0)).toBe(false);
    expect(provider.requiresReceipt(15)).toBe(true);
  });

  it("finds a seller listing that is waiting for a receipt", async () => {
    const { db } = createPaymentDb();
    const notifier = {
      sendReceiptToOwner: vi.fn(async () => undefined),
      tellSellerReceiptReceived: vi.fn(async () => undefined),
      tellSellerPublished: vi.fn(async () => undefined),
      tellSellerRejected: vi.fn(async () => undefined),
    };
    const payments = createPaymentService(
      db as never,
      { publish: vi.fn() } as unknown as ListingService,
      new ManualReceiptProvider(),
      notifier,
    );
    expect(await payments.findPendingListingId("seller-99")).toBe("listing-1");
  });

  it("sends the receipt to the owner without exposing the seller to buyers", async () => {
    const { db } = createPaymentDb();
    const notifier = {
      sendReceiptToOwner: vi.fn(async () => undefined),
      tellSellerReceiptReceived: vi.fn(async () => undefined),
      tellSellerPublished: vi.fn(async () => undefined),
      tellSellerRejected: vi.fn(async () => undefined),
    };
    const listings = {
      publish: vi.fn(async () => ({ shortCode: "A001", status: "PUBLISHED" })),
    } as unknown as ListingService;
    const payments = createPaymentService(db as never, listings, new ManualReceiptProvider(), notifier);

    await payments.submitReceipt({
      listingId: "listing-1",
      sellerTelegramId: "seller-99",
      photoFileId: "photo-1",
    });
    expect(notifier.sendReceiptToOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        sellerTelegramId: "seller-99",
        amount: 15,
        shortCode: "A001",
      }),
    );

    await payments.confirm("pay-1", "owner-1");
    expect(listings.publish).toHaveBeenCalledWith("listing-1", "owner-1");
    expect(notifier.tellSellerPublished).toHaveBeenCalledWith("seller-99", "A001", "store-1");
  });

  it("keeps the listing waiting after a rejected receipt", async () => {
    const { db, listing } = createPaymentDb();
    const notifier = {
      sendReceiptToOwner: vi.fn(async () => undefined),
      tellSellerReceiptReceived: vi.fn(async () => undefined),
      tellSellerPublished: vi.fn(async () => undefined),
      tellSellerRejected: vi.fn(async () => undefined),
    };
    const listings = {
      publish: vi.fn(),
    } as unknown as ListingService;
    const payments = createPaymentService(db as never, listings, new ManualReceiptProvider(), notifier);

    await payments.submitReceipt({
      listingId: "listing-1",
      sellerTelegramId: "seller-99",
      photoFileId: "photo-1",
    });
    await payments.reject("pay-1", "owner-1");
    expect(listing.status).toBe("PENDING_PAYMENT");
    expect(notifier.tellSellerRejected).toHaveBeenCalledWith("seller-99", "A001", "store-1");
    expect(listings.publish).not.toHaveBeenCalled();
  });
});
