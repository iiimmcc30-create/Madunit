import { Prisma } from "@prisma/client";
import type { Listing, PrismaClient, Seller, Store } from "@prisma/client";
import {
  assertOwnerOnlyMentions,
  formatListingCaption,
} from "../domain/caption";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../domain/errors";
import { extractFields, mergeExtractedFields } from "../domain/extract";
import {
  collectFingerprints,
  primaryFingerprint,
  strongFingerprints,
} from "../domain/fingerprint";
import { startOfUtcDay } from "../domain/moderation";
import type { ExtractedFields } from "../domain/extract";
import { formatShortCode, normalizeShortCode } from "../domain/short-code";
import { requiresListingReceipt } from "../domain/fee";
import { InlineKeyboard } from "grammy";
import { rewriteTradersCaption, isTradersMirrorBot } from "../domain/traders-ad";
import { askStartPayload, botDeepLink } from "../domain/start-payload";
import type { ChannelPublisher } from "../infra/publisher";
import type { SearchableListing } from "../agent/search";
import { writeAudit } from "./audit";
import { assertStoreServiceOpen } from "./subscription";

export interface ListingDraftInput {
  id?: string;
  storeId: string;
  sellerId: string;
  sellerTelegramId: string;
  videoFileId: string;
  videoUniqueId?: string | null;
  description: string;
  price: number;
  binding: string;
  extractedFields?: ExtractedFields;
}

export type ListingWithStore = Listing & { store: Store };
export type ListingWithStoreAndSeller = ListingWithStore & { seller: Seller };

export interface InquiryListingView extends ListingView {
  sellerTelegramId: string;
  ownerTelegramId: string;
}

export function toInquiryListingView(listing: ListingWithStoreAndSeller): InquiryListingView {
  return {
    ...toListingView(listing),
    sellerTelegramId: listing.seller.telegramId,
    ownerTelegramId: listing.store.ownerTelegramId,
  };
}

export interface ListingView {
  id: string;
  storeId: string;
  shortCode: string;
  description: string;
  price: number;
  binding: string;
  ownerUsername: string;
  botUsername: string;
  listingTemplate: string;
  status: Listing["status"];
  telegramVideoFileId: string;
  channelId: string;
  channelMessageId: string | null;
  sellerId: string;
  fingerprint: string | null;
  fingerprints: string[];
  listingFee: number;
  extractedFields: ExtractedFields;
}

export function toListingView(listing: ListingWithStore): ListingView {
  return {
    id: listing.id,
    storeId: listing.storeId,
    shortCode: listing.shortCode,
    description: listing.description,
    price: listing.price.toNumber(),
    binding: String(
      (listing.extractedFields as { binding?: string } | null)?.binding ?? "",
    ),
    ownerUsername: listing.store.ownerUsername,
    botUsername: String((listing.store as { botUsername?: string | null }).botUsername ?? ""),
    listingTemplate: listing.store.listingTemplate,
    status: listing.status,
    telegramVideoFileId: listing.telegramVideoFileId,
    channelId: listing.store.channelId ?? "",
    channelMessageId: listing.channelMessageId,
    sellerId: listing.sellerId,
    fingerprint: listing.fingerprint,
    fingerprints: listing.fingerprints ?? [],
    listingFee: listing.store.listingFee.toNumber(),
    extractedFields: (listing.extractedFields ?? {}) as ExtractedFields,
  };
}

export interface ListingPolicy {
  dailyListingLimit: number;
  botUsername?: string;
  storeId?: string;
  onPublished?: (listing: ListingView) => Promise<void>;
  getBotUsername?: (storeId: string) => string | undefined;
}

const DEFAULT_POLICY: ListingPolicy = { dailyListingLimit: 10 };

function inquiryMarkup(policy: ListingPolicy, shortCode: string, storeId?: string) {
  const username = (
    (storeId ? policy.getBotUsername?.(storeId) : undefined) ||
    policy.botUsername ||
    ""
  )
    .replace(/^@/, "")
    .trim();
  if (!username) return undefined;
  if (isTradersMirrorBot(username) || isTradersMirrorBot(policy.botUsername)) return undefined;
  return new InlineKeyboard().url("استفسار", botDeepLink(username, askStartPayload(shortCode)));
}

function scopedStoreId(policy: ListingPolicy, storeId?: string) {
  return storeId || policy.storeId;
}

function requireChannelId(channelId: string | null | undefined, shortCode?: string): string {
  if (!channelId) {
    throw new AppError(
      "store has no channel",
      shortCode
        ? `ما ربطنا قناة للمتجر، ما نقدر ننشر ${shortCode}.`
        : "اربط القناة أول بـ /setup (حوّل رسالة من القناة).",
      "NO_CHANNEL",
    );
  }
  return channelId;
}

export function createListingService(
  db: PrismaClient,
  publisher: ChannelPublisher,
  policy: ListingPolicy = DEFAULT_POLICY,
) {
  return {
    async saveDraft(input: ListingDraftInput) {
      return toListingView(await saveDraft(db, input, policy));
    },
    async getById(id: string) {
      return toListingView(await getById(db, id));
    },
    async getByShortCode(code: string, storeId?: string) {
      return toListingView(await getByShortCode(db, code, false, scopedStoreId(policy, storeId)));
    },
    requestPublish(listingId: string, actorId?: string) {
      return requestPublish(db, publisher, listingId, actorId, policy);
    },
    publish(listingId: string, actorId?: string) {
      return publishListing(db, publisher, listingId, actorId, policy);
    },
    cancel(listingId: string, actorId?: string) {
      return cancelListing(db, listingId, actorId);
    },
    markSold(code: string, actorTelegramId: string, storeId?: string) {
      return markSold(db, publisher, code, actorTelegramId, policy, scopedStoreId(policy, storeId));
    },
    markSoldAsSystem(code: string, actorTelegramId: string, storeId?: string) {
      return markSoldAsSystem(db, publisher, code, actorTelegramId, policy, scopedStoreId(policy, storeId));
    },
    async repriceListing(listingId: string, price: number) {
      const updated = await db.listing.update({ where: { id: listingId }, data: { price }, include: { store: true } });
      const view = toListingView(updated);
      if (updated.channelMessageId && updated.store.channelId) {
        try {
          await publisher.editCaption(
            updated.store.channelId,
            Number(updated.channelMessageId),
            buildListingCaption(view),
            inquiryMarkup(policy, view.shortCode, updated.storeId),
          );
        } catch {
          /* caption unchanged / message gone */
        }
      }
      return view;
    },
    deleteListing(code: string, actorTelegramId: string, storeId?: string) {
      return deleteListing(db, publisher, code, actorTelegramId, scopedStoreId(policy, storeId));
    },
    getInquiryByShortCode(code: string, storeId?: string) {
      return getInquiryByShortCode(db, code, scopedStoreId(policy, storeId));
    },
    getInquiryByChannelMessage(channelId: string, messageId: number) {
      return getInquiryByChannelMessage(db, channelId, messageId);
    },
    listPublishedForStore(storeId: string) {
      return listPublishedForStore(db, storeId);
    },
  };
}

export type ListingService = ReturnType<typeof createListingService>;

async function saveDraft(
  db: PrismaClient,
  input: ListingDraftInput,
  policy: ListingPolicy,
): Promise<ListingWithStore> {
  const extracted = mergeExtractedFields(
    extractFields(input.description, input.binding),
    input.extractedFields,
  );
  const fingerprints = collectFingerprints({
    videoUniqueId: input.videoUniqueId,
    fields: extracted,
  });
  const data = {
    telegramVideoFileId: input.videoFileId,
    telegramVideoUniqueId: input.videoUniqueId ?? null,
    description: input.description.trim(),
    extractedFields: extracted as Prisma.InputJsonValue,
    price: new Prisma.Decimal(input.price),
    fingerprint: primaryFingerprint(fingerprints),
    fingerprints,
    status: "DRAFT" as const,
  };

  if (!input.id && policy.dailyListingLimit > 0) {
    const used = await db.listing.count({
      where: {
        sellerId: input.sellerId,
        createdAt: { gte: startOfUtcDay() },
        status: { not: "DELETED" },
      },
    });
    if (used >= policy.dailyListingLimit) {
      throw new AppError(
        "daily listing limit",
        `وصلت الحد اليومي (${policy.dailyListingLimit} إعلانات). جرّب بكرة.`,
        "DAILY_LIMIT",
      );
    }
  }

  if (input.id) {
    const existing = await db.listing.findUnique({
      where: { id: input.id },
      include: { store: true },
    });
    if (!existing || existing.sellerId !== input.sellerId) {
      throw new NotFoundError("Listing", input.id, "ما لقيت مسودة الإعلان.");
    }
    if (existing.status !== "DRAFT") {
      throw new ConflictError("listing not draft", "الإعلان مو مسودة، ما يمديك تعدله من هنا.");
    }
    return db.listing.update({
      where: { id: input.id },
      data,
      include: { store: true },
    });
  }

  return db.$transaction(async (tx) => {
    const store = await tx.store.update({
      where: { id: input.storeId },
      data: { listingSeq: { increment: 1 } },
    });
    const listing = await tx.listing.create({
      data: {
        ...data,
        shortCode: formatShortCode(store.listingSeq, store.listingPrefix || "A"),
        storeId: input.storeId,
        sellerId: input.sellerId,
      },
      include: { store: true },
    });
    await writeAudit(tx, {
      actorId: input.sellerTelegramId,
      action: "listing.draft",
      entity: "Listing",
      entityId: listing.id,
      metadata: { shortCode: listing.shortCode },
    });
    return listing;
  });
}

async function getById(db: PrismaClient, id: string): Promise<ListingWithStore> {
  const listing = await db.listing.findUnique({
    where: { id },
    include: { store: true },
  });
  if (!listing) {
    throw new NotFoundError("Listing", id, "ما لقيت الإعلان.");
  }
  return listing;
}

async function getInquiryByShortCode(
  db: PrismaClient,
  rawCode: string,
  storeId?: string,
): Promise<InquiryListingView> {
  const listing = await getByShortCode(db, rawCode, true, storeId);
  return toInquiryListingView(listing);
}

async function getInquiryByChannelMessage(
  db: PrismaClient,
  channelId: string,
  messageId: number,
): Promise<InquiryListingView | null> {
  const listing = await db.listing.findFirst({
    where: {
      channelMessageId: String(messageId),
      store: { channelId },
    },
    include: { store: true, seller: true },
  });
  return listing ? toInquiryListingView(listing) : null;
}

async function getByShortCode(
  db: PrismaClient,
  rawCode: string,
  withSeller: true,
  storeId?: string,
): Promise<ListingWithStoreAndSeller>;
async function getByShortCode(
  db: PrismaClient,
  rawCode: string,
  withSeller?: false,
  storeId?: string,
): Promise<ListingWithStore>;
async function getByShortCode(
  db: PrismaClient,
  rawCode: string,
  withSeller = false,
  storeId?: string,
): Promise<ListingWithStore | ListingWithStoreAndSeller> {
  const shortCode = normalizeShortCode(rawCode);
  if (!shortCode) {
    throw new AppError("invalid code", "رقم الإعلان غير صحيح. مثال: A123 أو F1442", "INVALID_CODE");
  }
  const include = withSeller ? { store: true, seller: true } : { store: true };
  const listing = storeId
    ? await db.listing.findUnique({
        where: { storeId_shortCode: { storeId, shortCode } },
        include,
      })
    : await db.listing.findFirst({
        where: { shortCode },
        include,
      });
  if (!listing) {
    throw new NotFoundError("Listing", shortCode, `ما لقيت إعلان برقم ${shortCode}.`);
  }
  return listing;
}

const PRICE_LINE = /^([^\n]*?(?:السعر|سعر|القيمة|القيمه|قيمة|قيمه)\s*[:：\-–=]?\s*)(\d[\d,.]*)([^\n]*)$/m;

/** تأكد إن الكابشن فيه سطر سعر يطابق سعر القاعدة: عدّل الرقم أو أضف سطر قبل يوزر المالك */
export function ensurePriceLine(body: string, price: unknown, ownerUsername?: string | null): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return body;
  const value = String(Math.round(n));
  if (PRICE_LINE.test(body)) {
    return body.replace(PRICE_LINE, (_m, a, _b, c) => `${a}${value}${c}`);
  }
  const line = `السعر: ${value} ريال`;
  const owner = (ownerUsername ?? "").replace(/^@/, "");
  const tag = owner ? `@${owner}` : "";
  if (tag && body.endsWith(tag)) {
    const head = body.slice(0, -tag.length).trimEnd();
    return `${head}${head ? "\n" : ""}${line}\n\n${tag}`;
  }
  return `${body}\n${line}`;
}

export function buildListingCaption(listing: ListingView, sold = false): string {
  if (isTradersMirrorBot(listing.botUsername)) {
    const body = ensurePriceLine(
      rewriteTradersCaption(listing.description, listing.ownerUsername, {
        botUsername: listing.botUsername,
      }),
      listing.price,
      listing.ownerUsername,
    );
    return sold ? `تم البيع ✅\n\n${body}` : body;
  }
  const caption = formatListingCaption(
    {
      shortCode: listing.shortCode,
      description: listing.description,
      price: listing.price,
      binding: listing.binding,
      ownerUsername: listing.ownerUsername,
      sold,
    },
    listing.listingTemplate,
  );
  assertOwnerOnlyMentions(caption, listing.ownerUsername);
  return caption;
}

async function findPublishedDuplicate(
  db: PrismaClient,
  listing: ListingWithStore,
): Promise<ListingWithStore | null> {
  const strong = strongFingerprints(listing.fingerprints ?? []);
  if (strong.length === 0) return null;
  return db.listing.findFirst({
    where: {
      storeId: listing.storeId,
      status: "PUBLISHED",
      id: { not: listing.id },
      OR: [{ fingerprint: { in: strong } }, { fingerprints: { hasSome: strong } }],
    },
    include: { store: true },
  });
}

async function applyDuplicateUpdate(
  db: PrismaClient,
  publisher: ChannelPublisher,
  draft: ListingWithStore,
  existing: ListingWithStore,
  actorId: string | undefined,
  policy: ListingPolicy,
): Promise<ListingView> {
  const fingerprints = collectFingerprints({
    videoUniqueId: draft.telegramVideoUniqueId,
    fields: (draft.extractedFields ?? {}) as ExtractedFields,
  });
  const updated = await db.listing.update({
    where: { id: existing.id },
    data: {
      price: draft.price,
      description: draft.description,
      extractedFields: draft.extractedFields as Prisma.InputJsonValue,
      telegramVideoFileId: draft.telegramVideoFileId,
      telegramVideoUniqueId: draft.telegramVideoUniqueId,
      fingerprint: primaryFingerprint(fingerprints),
      fingerprints,
    },
    include: { store: true },
  });
  const view = toListingView(updated);
  const caption = buildListingCaption(view);
  if (updated.channelMessageId) {
    try {
      await publisher.editCaption(
        requireChannelId(updated.store.channelId, view.shortCode),
        Number(updated.channelMessageId),
        caption,
        inquiryMarkup(policy, view.shortCode, updated.storeId),
      );
    } catch {
      // الرسالة قد تكون محذوفة يدويًا
    }
  }
  await db.listing.update({
    where: { id: draft.id },
    data: { status: "DELETED" },
  });
  await writeAudit(db, {
    actorId: actorId ?? draft.sellerId,
    action: "listing.duplicate_update",
    entity: "Listing",
    entityId: updated.id,
    metadata: {
      fromShortCode: draft.shortCode,
      toShortCode: updated.shortCode,
      price: updated.price.toNumber(),
    },
  });
  await emitPublished(policy, view);
  return view;
}

async function requestPublish(
  db: PrismaClient,
  publisher: ChannelPublisher,
  listingId: string,
  actorId: string | undefined,
  policy: ListingPolicy,
): Promise<ListingView> {
  const listing = await getById(db, listingId);
  if (listing.status !== "DRAFT") {
    throw new ConflictError("listing not draft", "هذا الإعلان ما عاد مسودة.");
  }
  assertStoreServiceOpen(listing.store);
  const duplicate = await findPublishedDuplicate(db, listing);
  if (duplicate) {
    if (duplicate.sellerId !== listing.sellerId) {
      throw new ConflictError(
        "duplicate listing",
        `هذا الحساب معروض في القناة برقم ${duplicate.shortCode}. ما نقدر ننشره مرتين.`,
      );
    }
    return applyDuplicateUpdate(db, publisher, listing, duplicate, actorId, policy);
  }
  const fee = listing.store.listingFee.toNumber();
  if (requiresListingReceipt(fee)) {
    const pending = await db.listing.update({
      where: { id: listing.id },
      data: { status: "PENDING_PAYMENT" },
      include: { store: true },
    });
    await writeAudit(db, {
      actorId: actorId ?? listing.sellerId,
      action: "listing.pending_payment",
      entity: "Listing",
      entityId: listing.id,
      metadata: { shortCode: listing.shortCode, fee },
    });
    return toListingView(pending);
  }
  return publishListing(db, publisher, listingId, actorId, policy);
}

async function publishListing(
  db: PrismaClient,
  publisher: ChannelPublisher,
  listingId: string,
  actorId: string | undefined,
  policy: ListingPolicy,
): Promise<ListingView> {
  const listing = await getById(db, listingId);
  if (listing.status !== "DRAFT" && listing.status !== "PENDING_PAYMENT") {
    throw new ConflictError("listing not draft", "هذا الإعلان ما عاد مسودة.");
  }
  assertStoreServiceOpen(listing.store);
  const channelId = requireChannelId(listing.store.channelId, listing.shortCode);

  const caption = buildListingCaption(toListingView(listing));
  let sent: { messageId: number; videoMessageId?: number };
  try {
    sent = await publisher.sendListing(channelId, {
      videoFileId: listing.telegramVideoFileId,
      caption,
      replyMarkup: inquiryMarkup(policy, listing.shortCode, listing.storeId),
    });
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : "publish failed",
      "ما قدرت أنشر في القناة. تأكد إن البوت أدمن ويقدر يرسل رسائل.",
      "PUBLISH_FAILED",
    );
  }

  const published = await db.$transaction(async (tx) => {
    const updated = await tx.listing.update({
      where: { id: listing.id },
      data: {
        status: "PUBLISHED",
        channelMessageId: String(sent.messageId),
        channelVideoMessageId: sent.videoMessageId ? String(sent.videoMessageId) : null,
      },
      include: { store: true },
    });
    await tx.seller.update({
      where: { id: listing.sellerId },
      data: { listingCount: { increment: 1 } },
    });
    await writeAudit(tx, {
      actorId: actorId ?? listing.sellerId,
      action: "listing.publish",
      entity: "Listing",
      entityId: listing.id,
      metadata: {
        shortCode: listing.shortCode,
        channelMessageId: sent.messageId,
      },
    });
    return updated;
  });

  const view = toListingView(published);
  await emitPublished(policy, view);
  return view;
}

async function listPublishedForStore(db: PrismaClient, storeId: string): Promise<SearchableListing[]> {
  const rows = await db.listing.findMany({
    where: { storeId, status: "PUBLISHED" },
    include: { store: true },
    take: 80,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    shortCode: row.shortCode,
    storeId: row.storeId,
    price: row.price.toNumber(),
    description: row.description,
    ownerUsername: row.store.ownerUsername,
    extractedFields: (row.extractedFields ?? {}) as ExtractedFields,
  }));
}

async function emitPublished(policy: ListingPolicy, view: ListingView) {
  if (!policy.onPublished) return;
  try {
    await policy.onPublished(view);
  } catch {
    // التبليغ لا يوقف النشر
  }
}

async function cancelListing(db: PrismaClient, listingId: string, actorId?: string) {
  const listing = await getById(db, listingId);
  if (listing.status !== "DRAFT" && listing.status !== "PENDING_PAYMENT") {
    throw new ConflictError("cannot cancel", "ما يمديك تلغي إلا المسودات أو اللي تنتظر إيصال.");
  }
  const updated = await db.listing.update({
    where: { id: listingId },
    data: { status: "DELETED" },
    include: { store: true },
  });
  await writeAudit(db, {
    actorId,
    action: "listing.cancel",
    entity: "Listing",
    entityId: listingId,
    metadata: { shortCode: listing.shortCode },
  });
  return toListingView(updated);
}

function assertOwner(listing: ListingWithStore, actorTelegramId: string) {
  if (listing.store.ownerTelegramId !== actorTelegramId) {
    throw new ForbiddenError();
  }
}

async function markSold(
  db: PrismaClient,
  publisher: ChannelPublisher,
  code: string,
  actorTelegramId: string,
  policy: ListingPolicy,
  storeId?: string,
) {
  const listing = await getByShortCode(db, code, false, storeId);
  assertOwner(listing, actorTelegramId);
  if (listing.status !== "PUBLISHED") {
    throw new ConflictError(
      "not published",
      listing.status === "SOLD"
        ? `الإعلان ${listing.shortCode} مباع من قبل.`
        : `الإعلان ${listing.shortCode} مو منشور.`,
    );
  }

  const caption = buildListingCaption(toListingView(listing), true);
  if (listing.channelMessageId) {
    try {
      await publisher.editCaption(
        requireChannelId(listing.store.channelId, listing.shortCode),
        Number(listing.channelMessageId),
        caption,
        inquiryMarkup(policy, listing.shortCode, listing.storeId),
      );
    } catch {
      // الرسالة قد تكون محذوفة يدويًا — نحدّث القاعدة على أي حال
    }
  }

  const updated = await db.listing.update({
    where: { id: listing.id },
    data: { status: "SOLD" },
    include: { store: true },
  });
  await writeAudit(db, {
    actorId: actorTelegramId,
    action: "listing.sold",
    entity: "Listing",
    entityId: listing.id,
    metadata: { shortCode: listing.shortCode },
  });
  return toListingView(updated);
}

async function markSoldAsSystem(
  db: PrismaClient,
  publisher: ChannelPublisher,
  code: string,
  actorTelegramId: string,
  policy: ListingPolicy,
  storeId?: string,
) {
  const listing = await getByShortCode(db, code, false, storeId);
  if (listing.status === "SOLD") {
    return toListingView(listing);
  }
  if (listing.status !== "PUBLISHED") {
    throw new ConflictError(
      "not published",
      `الإعلان ${listing.shortCode} مو منشور.`,
    );
  }

  const caption = buildListingCaption(toListingView(listing), true);
  if (listing.channelMessageId) {
    try {
      await publisher.editCaption(
        requireChannelId(listing.store.channelId, listing.shortCode),
        Number(listing.channelMessageId),
        caption,
        inquiryMarkup(policy, listing.shortCode, listing.storeId),
      );
    } catch {
      // ignore missing channel message
    }
  }

  const updated = await db.listing.update({
    where: { id: listing.id },
    data: { status: "SOLD" },
    include: { store: true },
  });
  await writeAudit(db, {
    actorId: actorTelegramId,
    action: "listing.sold",
    entity: "Listing",
    entityId: listing.id,
    metadata: { shortCode: listing.shortCode, via: "seller-inquiry" },
  });
  return toListingView(updated);
}

async function deleteListing(
  db: PrismaClient,
  publisher: ChannelPublisher,
  code: string,
  actorTelegramId: string,
  storeId?: string,
) {
  const listing = await getByShortCode(db, code, false, storeId);
  assertOwner(listing, actorTelegramId);
  if (listing.status === "DELETED") {
    throw new ConflictError("already deleted", `الإعلان ${listing.shortCode} محذوف من قبل.`);
  }

  for (const messageId of [listing.channelMessageId, listing.channelVideoMessageId]) {
    if (!messageId) continue;
    try {
      await publisher.deleteMessage(requireChannelId(listing.store.channelId, listing.shortCode), Number(messageId));
    } catch {
      // ignore missing channel message
    }
  }

  const updated = await db.listing.update({
    where: { id: listing.id },
    data: { status: "DELETED", channelMessageId: null, channelVideoMessageId: null },
    include: { store: true },
  });
  await writeAudit(db, {
    actorId: actorTelegramId,
    action: "listing.delete",
    entity: "Listing",
    entityId: listing.id,
    metadata: { shortCode: listing.shortCode },
  });
  return toListingView(updated);
}
