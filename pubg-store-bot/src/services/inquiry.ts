import { ownerHandlesSales } from "../domain/owner-sales";
import type { PrismaClient } from "@prisma/client";
import { texts } from "../bot/texts";
import { AppError, NotFoundError } from "../domain/errors";
import { formatPrice } from "../domain/price";
import type { InquiryNotifier } from "../infra/notify";
import type { InquiryJobs } from "../infra/queue";
import type { InquiryListingView, ListingService } from "./listing";
import { writeAudit } from "./audit";
import { trackReferral } from "./referral";

export interface OpenInquiryInput {
  buyerTelegramId: string;
  shortCode?: string;
  channelId?: string;
  channelMessageId?: number;
  notifyBuyer?: boolean;
  storeId?: string;
}

export type InquiryBuyerOutcome =
  | "checking"
  | "already_waiting"
  | "sold"
  | "not_published"
  | "own"
  | "not_found"
  | "timeout";

export interface OpenInquiryResult {
  listing: InquiryListingView | null;
  outcome: InquiryBuyerOutcome;
  buyerMessage: string;
}

export type NotifierSource = InquiryNotifier | ((storeId: string) => InquiryNotifier);

function notifierFor(source: NotifierSource, storeId: string): InquiryNotifier {
  return typeof source === "function" ? source(storeId) : source;
}

export function createInquiryService(
  db: PrismaClient,
  listings: ListingService,
  notifier: NotifierSource,
  jobs: InquiryJobs,
) {
  return {
    openFromBuyer(input: OpenInquiryInput) {
      return openFromBuyer(db, listings, notifier, jobs, input);
    },
    beginAvailable(inquiryId: string, sellerTelegramId: string) {
      return beginAvailable(db, notifier, inquiryId, sellerTelegramId);
    },
    confirmAvailable(inquiryId: string, sellerTelegramId: string, price: number) {
      return confirmAvailable(db, notifier, jobs, inquiryId, sellerTelegramId, price);
    },
    /** يرد البائع برقم سعر على أحدث استفسار منتظر (إذا ضاعت جلسة pending). */
    confirmAvailableLatest(sellerTelegramId: string, price: number, storeId?: string) {
      return confirmAvailableLatest(db, notifier, jobs, sellerTelegramId, price, storeId);
    },
    confirmSold(inquiryId: string, sellerTelegramId: string) {
      return confirmSold(db, listings, notifier, jobs, inquiryId, sellerTelegramId);
    },
    remind(inquiryId: string) {
      return remind(db, notifier, inquiryId);
    },
    timeout(inquiryId: string) {
      return timeout(db, notifier, jobs, inquiryId);
    },
    notifyBuyersListingSold(listingId: string) {
      return notifyBuyersListingSold(db, notifier, jobs, listingId);
    },
    resolveListing(input: OpenInquiryInput) {
      return resolveListing(listings, input);
    },
  };
}

export type InquiryService = ReturnType<typeof createInquiryService>;

async function resolveListing(listings: ListingService, input: OpenInquiryInput) {
  if (input.channelId && input.channelMessageId != null) {
    const byMessage = await listings.getInquiryByChannelMessage(
      input.channelId,
      input.channelMessageId,
    );
    if (byMessage) return byMessage;
  }
  if (input.shortCode) {
    return listings.getInquiryByShortCode(input.shortCode, input.storeId);
  }
  return null;
}

async function ownerHandlesSalesStore(db: PrismaClient, storeId?: string | null): Promise<boolean> {
  if (!storeId) return false;
  try {
    const row = await db.store.findUnique({ where: { id: storeId }, select: { botUsername: true } });
    return ownerHandlesSales(row?.botUsername);
  } catch {
    return false;
  }
}

async function openFromBuyer(
  db: PrismaClient,
  listings: ListingService,
  notifier: NotifierSource,
  jobs: InquiryJobs,
  input: OpenInquiryInput,
): Promise<OpenInquiryResult> {
  const notifyBuyer = input.notifyBuyer !== false;
  const nFor = (storeId?: string | null) => notifierFor(notifier, storeId || input.storeId || "");
  const tell = async (storeId: string | null | undefined, send: (n: InquiryNotifier) => Promise<void>) => {
    if (notifyBuyer) await send(nFor(storeId));
  };

  let listing: InquiryListingView | null;
  try {
    listing = await resolveListing(listings, input);
  } catch (error) {
    if (error instanceof NotFoundError) {
      const buyerMessage = texts.buyerNotPublished(input.shortCode ?? "", "ما لقيت الإعلان.");
      await tell(input.storeId, (n) =>
        n.tellBuyerNotPublished(input.buyerTelegramId, input.shortCode ?? "", "ما لقيت الإعلان."),
      );
      return { listing: null, outcome: "not_found", buyerMessage };
    }
    throw error;
  }

  if (!listing) {
    const buyerMessage = texts.buyerNotFound;
    await tell(input.storeId, (n) =>
      n.tellBuyerNotPublished(input.buyerTelegramId, input.shortCode ?? "", "ما تعرّفت على الإعلان."),
    );
    return { listing: null, outcome: "not_found", buyerMessage };
  }

  const n = nFor(listing.storeId);

  if (listing.sellerTelegramId === input.buyerTelegramId) {
    await tell(listing.storeId, (bot) => bot.tellBuyerOwnListing(input.buyerTelegramId));
    return { listing, outcome: "own", buyerMessage: texts.buyerOwnListing };
  }

  if (listing.storeId && listing.sellerTelegramId !== input.buyerTelegramId) {
    await trackReferral(db, {
      storeId: listing.storeId,
      telegramId: input.buyerTelegramId,
      role: "BUYER",
      source: listing.shortCode,
    });
  }

  // sarhstoree: لا نرد من حالة القاعدة — نسأل المعلن دائماً
  const askSellerAlways = await ownerHandlesSalesStore(db, listing.storeId);
  if (listing.status === "SOLD" && !askSellerAlways) {
    await tell(listing.storeId, (bot) =>
      bot.tellBuyerSold(input.buyerTelegramId, listing.shortCode, listing.ownerUsername),
    );
    return { listing, outcome: "sold", buyerMessage: texts.buyerSold(listing.shortCode) };
  }

  if (listing.status !== "PUBLISHED" && !askSellerAlways) {
    const reason = listing.status === "DELETED" ? "محذوف." : "مو منشور.";
    await tell(listing.storeId, (bot) =>
      bot.tellBuyerNotPublished(input.buyerTelegramId, listing.shortCode, reason),
    );
    return { listing, outcome: "not_published", buyerMessage: texts.buyerNotPublished(listing.shortCode, reason) };
  }

  const existing = await db.inquiry.findFirst({
    where: {
      listingId: listing.id,
      buyerTelegramId: input.buyerTelegramId,
      status: "WAITING_SELLER",
    },
  });
  if (existing) {
    await tell(listing.storeId, (bot) => bot.tellBuyerAlreadyWaiting(input.buyerTelegramId, listing.shortCode));
    return { listing, outcome: "already_waiting", buyerMessage: texts.buyerAlreadyWaiting(listing.shortCode) };
  }

  const inquiry = await db.inquiry.create({
    data: {
      listingId: listing.id,
      buyerTelegramId: input.buyerTelegramId,
      status: "WAITING_SELLER",
      sellerNotifiedAt: new Date(),
    },
  });

  await writeAudit(db, {
    actorId: input.buyerTelegramId,
    action: "inquiry.open",
    entity: "Inquiry",
    entityId: inquiry.id,
    metadata: { shortCode: listing.shortCode },
  });

  const delivered = await n.askSeller(
    listing.sellerTelegramId,
    inquiry.id,
    listing.shortCode,
  );

  if (!delivered) {
    await db.inquiry.update({
      where: { id: inquiry.id },
      data: { status: "TIMEOUT", timedOutAt: new Date() },
    });
    const [buyer, seller] = await Promise.all([
      n.resolveParty(input.buyerTelegramId),
      n.resolveParty(listing.sellerTelegramId),
    ]);
    await tell(listing.storeId, (bot) =>
      bot.tellBuyerTimeout(input.buyerTelegramId, listing.shortCode, listing.ownerUsername),
    );
    await n.tellOwnerSellerUnreachable({
      ownerId: listing.ownerTelegramId,
      shortCode: listing.shortCode,
      buyer,
      seller,
    });
    return { listing, outcome: "timeout", buyerMessage: texts.buyerTimeout(listing.shortCode) };
  }

  try {
    await jobs.schedule(inquiry.id);
  } catch {
    // لا نوقف الاستفسار إذا فشل جدولة التذكير/المهلة — البائع والمشتري لازم يكملون
  }
  await tell(listing.storeId, (bot) => bot.tellBuyerChecking(input.buyerTelegramId, listing.shortCode));
  return { listing, outcome: "checking", buyerMessage: texts.buyerChecking(listing.shortCode) };
}

async function loadWaitingInquiry(
  db: PrismaClient,
  inquiryId: string,
  sellerTelegramId: string,
) {
  const inquiry = await db.inquiry.findUnique({
    where: { id: inquiryId },
    include: { listing: { include: { store: true, seller: true } } },
  });
  if (!inquiry || inquiry.listing.seller.telegramId !== sellerTelegramId) {
    throw new AppError("inquiry forbidden", texts.sellerInquiryGone, "INQUIRY_FORBIDDEN");
  }
  if (inquiry.status !== "WAITING_SELLER") {
    throw new AppError("inquiry closed", texts.sellerInquiryGone, "INQUIRY_CLOSED");
  }
  return inquiry;
}

async function confirmAvailableLatest(
  db: PrismaClient,
  notifier: NotifierSource,
  jobs: InquiryJobs,
  sellerTelegramId: string,
  price: number,
  storeId?: string,
) {
  const waiting = await db.inquiry.findFirst({
    where: {
      status: "WAITING_SELLER",
      listing: {
        seller: { telegramId: sellerTelegramId },
        ...(storeId ? { storeId } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!waiting) {
    throw new AppError("inquiry forbidden", texts.sellerInquiryGone, "INQUIRY_FORBIDDEN");
  }
  return confirmAvailable(db, notifier, jobs, waiting.id, sellerTelegramId, price);
}

async function beginAvailable(
  db: PrismaClient,
  notifier: NotifierSource,
  inquiryId: string,
  sellerTelegramId: string,
) {
  const inquiry = await loadWaitingInquiry(db, inquiryId, sellerTelegramId);
  const n = notifierFor(notifier, inquiry.listing.storeId);
  await n.tellSellerPricePrompt(sellerTelegramId);
  return inquiry;
}

async function confirmAvailable(
  db: PrismaClient,
  notifier: NotifierSource,
  jobs: InquiryJobs,
  inquiryId: string,
  sellerTelegramId: string,
  price: number,
) {
  const inquiry = await loadWaitingInquiry(db, inquiryId, sellerTelegramId);
  const n = notifierFor(notifier, inquiry.listing.storeId);
  const updated = await db.inquiry.updateMany({
    where: { id: inquiryId, status: "WAITING_SELLER" },
    data: {
      status: "AVAILABLE",
      finalPrice: price,
      sellerRepliedAt: new Date(),
    },
  });
  if (updated.count === 0) {
    throw new AppError("inquiry closed", texts.sellerInquiryGone, "INQUIRY_CLOSED");
  }

  await jobs.cancel(inquiryId).catch(() => undefined);
  const listing = inquiry.listing;
  const [buyer, seller] = await Promise.all([
    n.resolveParty(inquiry.buyerTelegramId),
    n.resolveParty(sellerTelegramId),
  ]);

  // بعد تحديث الحالة: أي فشل إشعار ما يرجع "الاستفسار انتهى" للبائع
  try {
    await n.tellBuyerAvailable(
      inquiry.buyerTelegramId,
      listing.shortCode,
      price,
      listing.store.ownerUsername,
    );
  } catch {
    // المشتري قد يكون مغلق الخاص
  }
  try {
    await n.tellOwnerAvailable({
      ownerId: listing.store.ownerTelegramId,
      shortCode: listing.shortCode,
      price,
      buyer,
      seller,
      description: listing.description,
    });
  } catch {
    // المالك قد يكون غير متاح
  }
  try {
    await n.tellSellerAck(
      sellerTelegramId,
      texts.sellerAvailableAck(listing.shortCode, formatPrice(price)),
    );
  } catch {
    // تجاهل
  }
  await writeAudit(db, {
    actorId: sellerTelegramId,
    action: "inquiry.available",
    entity: "Inquiry",
    entityId: inquiryId,
    metadata: { shortCode: listing.shortCode, price },
  }).catch(() => undefined);
}

async function confirmSold(
  db: PrismaClient,
  listings: ListingService,
  notifier: NotifierSource,
  jobs: InquiryJobs,
  inquiryId: string,
  sellerTelegramId: string,
) {
  const inquiry = await loadWaitingInquiry(db, inquiryId, sellerTelegramId);
  const n = notifierFor(notifier, inquiry.listing.storeId);
  await listings.markSoldAsSystem(
    inquiry.listing.shortCode,
    sellerTelegramId,
    inquiry.listing.storeId,
  );
  await db.inquiry.update({
    where: { id: inquiryId },
    data: { status: "SOLD", sellerRepliedAt: new Date() },
  });
  await jobs.cancel(inquiryId);
  await n.tellBuyerSold(
    inquiry.buyerTelegramId,
    inquiry.listing.shortCode,
    inquiry.listing.store.ownerUsername,
  );
  await n.tellSellerAck(
    sellerTelegramId,
    texts.sellerSoldAck(inquiry.listing.shortCode),
  );
  await writeAudit(db, {
    actorId: sellerTelegramId,
    action: "inquiry.sold",
    entity: "Inquiry",
    entityId: inquiryId,
    metadata: { shortCode: inquiry.listing.shortCode },
  });
  await notifyBuyersListingSold(db, notifier, jobs, inquiry.listingId, inquiryId);
}

async function remind(db: PrismaClient, notifier: NotifierSource, inquiryId: string) {
  const inquiry = await db.inquiry.findUnique({
    where: { id: inquiryId },
    include: { listing: { include: { seller: true, store: true } } },
  });
  if (!inquiry || inquiry.status !== "WAITING_SELLER" || inquiry.reminderSentAt) {
    return;
  }
  await db.inquiry.update({
    where: { id: inquiryId },
    data: { reminderSentAt: new Date() },
  });
  const n = notifierFor(notifier, inquiry.listing.storeId);
  await n.remindSeller(
    inquiry.listing.seller.telegramId,
    inquiry.id,
    inquiry.listing.shortCode,
  );
}

async function timeout(
  db: PrismaClient,
  notifier: NotifierSource,
  jobs: InquiryJobs,
  inquiryId: string,
) {
  const updated = await db.inquiry.updateMany({
    where: { id: inquiryId, status: "WAITING_SELLER" },
    data: { status: "TIMEOUT", timedOutAt: new Date() },
  });
  if (updated.count === 0) return;

  const inquiry = await db.inquiry.findUnique({
    where: { id: inquiryId },
    include: { listing: { include: { store: true, seller: true } } },
  });
  if (!inquiry) return;

  await jobs.cancel(inquiryId);
  const n = notifierFor(notifier, inquiry.listing.storeId);
  const [buyer, seller] = await Promise.all([
    n.resolveParty(inquiry.buyerTelegramId),
    n.resolveParty(inquiry.listing.seller.telegramId),
  ]);
  await n.tellBuyerTimeout(
    inquiry.buyerTelegramId,
    inquiry.listing.shortCode,
    inquiry.listing.store.ownerUsername,
  );
  await n.tellOwnerTimeout({
    ownerId: inquiry.listing.store.ownerTelegramId,
    shortCode: inquiry.listing.shortCode,
    buyer,
    seller,
  });
  await writeAudit(db, {
    action: "inquiry.timeout",
    entity: "Inquiry",
    entityId: inquiryId,
    metadata: { shortCode: inquiry.listing.shortCode },
  });
}

async function notifyBuyersListingSold(
  db: PrismaClient,
  notifier: NotifierSource,
  jobs: InquiryJobs,
  listingId: string,
  exceptInquiryId?: string,
) {
  const open = await db.inquiry.findMany({
    where: {
      listingId,
      status: "WAITING_SELLER",
      ...(exceptInquiryId ? { id: { not: exceptInquiryId } } : {}),
    },
    include: { listing: { include: { store: true } } },
  });

  for (const inquiry of open) {
    await db.inquiry.update({
      where: { id: inquiry.id },
      data: { status: "SOLD" },
    });
    await jobs.cancel(inquiry.id);
    const n = notifierFor(notifier, inquiry.listing.storeId);
    await n.tellBuyerSold(
      inquiry.buyerTelegramId,
      inquiry.listing.shortCode,
      inquiry.listing.store.ownerUsername,
    );
  }
}
