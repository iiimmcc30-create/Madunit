import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { AppError, ForbiddenError, NotFoundError } from "../domain/errors";
import { requiresListingReceipt } from "../domain/fee";
import type { PaymentProvider } from "../payments/provider";
import { writeAudit } from "./audit";
import type { ListingService, ListingView } from "./listing";

export interface PaymentNotifier {
  sendReceiptToOwner(input: {
    storeId: string;
    ownerId: string;
    paymentId: string;
    shortCode: string;
    amount: number;
    photoFileId: string;
    sellerTelegramId: string;
  }): Promise<void>;
  tellSellerReceiptReceived(sellerId: string, shortCode: string, storeId?: string): Promise<void>;
  tellSellerPublished(sellerId: string, shortCode: string, storeId?: string): Promise<void>;
  tellSellerRejected(sellerId: string, shortCode: string, storeId?: string): Promise<void>;
}

export function createPaymentService(
  db: PrismaClient,
  listings: ListingService,
  provider: PaymentProvider,
  notifier: PaymentNotifier,
) {
  return {
    requiresReceipt(amount: number) {
      return provider.requiresReceipt(amount);
    },
    submitReceipt(input: { listingId: string; sellerTelegramId: string; photoFileId: string }) {
      return submitReceipt(db, notifier, input);
    },
    findPendingListingId(sellerTelegramId: string, storeId?: string) {
      return findPendingListingId(db, sellerTelegramId, storeId);
    },
    confirm(paymentId: string, ownerTelegramId: string) {
      return confirmPayment(db, listings, notifier, paymentId, ownerTelegramId);
    },
    reject(paymentId: string, ownerTelegramId: string) {
      return rejectPayment(db, notifier, paymentId, ownerTelegramId);
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;

async function findPendingListingId(db: PrismaClient, sellerTelegramId: string, storeId?: string) {
  const listing = await db.listing.findFirst({
    where: {
      status: "PENDING_PAYMENT",
      seller: { telegramId: sellerTelegramId },
      ...(storeId ? { storeId } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return listing?.id ?? null;
}

async function submitReceipt(
  db: PrismaClient,
  notifier: PaymentNotifier,
  input: { listingId: string; sellerTelegramId: string; photoFileId: string },
) {
  const listing = await db.listing.findUnique({
    where: { id: input.listingId },
    include: { store: true, seller: true },
  });
  if (!listing) {
    throw new NotFoundError("Listing", input.listingId, "ما لقيت الإعلان.");
  }
  if (listing.seller.telegramId !== input.sellerTelegramId) {
    throw new ForbiddenError();
  }
  if (listing.status !== "PENDING_PAYMENT") {
    throw new AppError("not pending", "هذا الإعلان ما ينتظر إيصال.", "NOT_PENDING");
  }
  const amount = listing.store.listingFee.toNumber();
  if (!requiresListingReceipt(amount)) {
    throw new AppError("free listing", "هذا المتجر بدون رسوم إعلان.", "NO_FEE");
  }

  const payment = await db.payment.create({
    data: {
      listingId: listing.id,
      amount: new Prisma.Decimal(amount),
      receiptPhotoFileId: input.photoFileId,
      status: "PENDING",
    },
  });
  await writeAudit(db, {
    actorId: input.sellerTelegramId,
    action: "payment.receipt",
    entity: "Payment",
    entityId: payment.id,
    metadata: { shortCode: listing.shortCode, amount },
  });
  await notifier.sendReceiptToOwner({
    storeId: listing.storeId,
    ownerId: listing.store.ownerTelegramId,
    paymentId: payment.id,
    shortCode: listing.shortCode,
    amount,
    photoFileId: input.photoFileId,
    sellerTelegramId: listing.seller.telegramId,
  });
  await notifier.tellSellerReceiptReceived(input.sellerTelegramId, listing.shortCode, listing.storeId);
  return payment;
}

async function confirmPayment(
  db: PrismaClient,
  listings: ListingService,
  notifier: PaymentNotifier,
  paymentId: string,
  ownerTelegramId: string,
): Promise<ListingView> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { listing: { include: { store: true, seller: true } } },
  });
  if (!payment) {
    throw new NotFoundError("Payment", paymentId, "ما لقيت الإيصال.");
  }
  if (payment.listing.store.ownerTelegramId !== ownerTelegramId) {
    throw new ForbiddenError();
  }
  if (payment.status !== "PENDING") {
    throw new AppError("payment closed", "هذا الإيصال تُعالج من قبل.", "PAYMENT_CLOSED");
  }

  await db.payment.update({
    where: { id: paymentId },
    data: { status: "CONFIRMED" },
  });
  const published = await listings.publish(payment.listingId, ownerTelegramId);
  await notifier.tellSellerPublished(
    payment.listing.seller.telegramId,
    published.shortCode,
    payment.listing.storeId,
  );
  await writeAudit(db, {
    actorId: ownerTelegramId,
    action: "payment.confirm",
    entity: "Payment",
    entityId: paymentId,
    metadata: { shortCode: published.shortCode },
  });
  return published;
}

async function rejectPayment(
  db: PrismaClient,
  notifier: PaymentNotifier,
  paymentId: string,
  ownerTelegramId: string,
) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { listing: { include: { store: true, seller: true } } },
  });
  if (!payment) {
    throw new NotFoundError("Payment", paymentId, "ما لقيت الإيصال.");
  }
  if (payment.listing.store.ownerTelegramId !== ownerTelegramId) {
    throw new ForbiddenError();
  }
  await db.payment.update({
    where: { id: paymentId },
    data: { status: "REJECTED" },
  });
  await db.listing.update({
    where: { id: payment.listingId },
    data: { status: "PENDING_PAYMENT" },
  });
  await notifier.tellSellerRejected(
    payment.listing.seller.telegramId,
    payment.listing.shortCode,
    payment.listing.storeId,
  );
  await writeAudit(db, {
    actorId: ownerTelegramId,
    action: "payment.reject",
    entity: "Payment",
    entityId: paymentId,
    metadata: { shortCode: payment.listing.shortCode },
  });
}
