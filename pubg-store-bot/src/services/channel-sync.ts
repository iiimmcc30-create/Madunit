import { Prisma } from "@prisma/client";
import type { Api } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { extractChannelAd } from "../domain/channel-ad";
import { AppError } from "../domain/errors";
import {
  extractAdIdentity,
  normalizeShortCode,
  parseShortCodeParts,
} from "../domain/short-code";
import { getOrCreateSeller } from "./seller";
import { writeAudit } from "./audit";

const DEFAULT_WALK = 250;
const PROBE_DELAY_MS = 80;
const BINARY_HIGH = 5_000_000;

export interface ChannelSyncOptions {
  /** Max messages to walk backwards from the high watermark. */
  walkLimit?: number;
  /** Known high message id (from a forwarded post or previous sync). */
  seedMessageId?: number;
  /** Optional last code like F1442 — sets listingPrefix/seq and helps identity. */
  seedCode?: string | null;
  /** Scratch chat for forward probes (usually owner DM). */
  scratchChatId: string;
  /** Called with progress logs. */
  onProgress?: (msg: string) => void;
}

export interface ChannelSyncResult {
  scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  soldMarked: number;
  highMessageId: number | null;
  listingSeq: number;
  listingPrefix: string;
  error?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeExists(
  api: Api,
  channelId: string,
  messageId: number,
  scratchChatId: string,
): Promise<boolean> {
  try {
    const forwarded = await api.forwardMessage(scratchChatId, channelId, messageId);
    await api.deleteMessage(scratchChatId, forwarded.message_id).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function probeMessage(
  api: Api,
  channelId: string,
  messageId: number,
  scratchChatId: string,
): Promise<{
  messageId: number;
  caption: string;
  photo?: Array<{ file_id: string }>;
  video?: { file_id: string };
  animation?: { file_id: string };
  document?: { file_id: string; mime_type?: string };
} | null> {
  try {
    const forwarded = await api.forwardMessage(scratchChatId, channelId, messageId);
    const payload = {
      messageId,
      caption: forwarded.caption ?? forwarded.text ?? "",
      photo: forwarded.photo,
      video: forwarded.video,
      animation: forwarded.animation,
      document: forwarded.document,
    };
    await api.deleteMessage(scratchChatId, forwarded.message_id).catch(() => undefined);
    return payload;
  } catch {
    return null;
  }
}

/** Binary search for the highest existing channel message id (Bot API has no history). */
export async function findChannelHighWatermark(
  api: Api,
  channelId: string,
  scratchChatId: string,
  seed?: number,
): Promise<number | null> {
  if (seed && seed > 0) {
    if (await probeExists(api, channelId, seed, scratchChatId)) {
      // Walk up a bit in case seed is not the tip
      let hi = seed;
      for (let step = 1; step <= 64; step *= 2) {
        const tryId = seed + step;
        await sleep(PROBE_DELAY_MS);
        if (await probeExists(api, channelId, tryId, scratchChatId)) {
          hi = tryId;
        } else break;
      }
      // linear refine
      for (let id = hi + 1; id <= hi + 32; id++) {
        await sleep(PROBE_DELAY_MS);
        if (await probeExists(api, channelId, id, scratchChatId)) hi = id;
        else break;
      }
      return hi;
    }
  }

  // Exponential search then binary
  let lo = 1;
  let hi = 1;
  if (!(await probeExists(api, channelId, 1, scratchChatId))) {
    // Channel empty or bot can't read — try a few common starts
    for (const start of [2, 5, 10, 50, 100]) {
      await sleep(PROBE_DELAY_MS);
      if (await probeExists(api, channelId, start, scratchChatId)) {
        lo = start;
        hi = start;
        break;
      }
    }
    if (hi === 1 && !(await probeExists(api, channelId, 1, scratchChatId))) {
      return null;
    }
  }

  while (hi < BINARY_HIGH) {
    const next = Math.min(hi * 2, BINARY_HIGH);
    await sleep(PROBE_DELAY_MS);
    if (await probeExists(api, channelId, next, scratchChatId)) {
      lo = next;
      hi = next;
    } else {
      // binary between lo and next
      let left = lo;
      let right = next;
      while (right - left > 1) {
        const mid = Math.floor((left + right) / 2);
        await sleep(PROBE_DELAY_MS);
        if (await probeExists(api, channelId, mid, scratchChatId)) left = mid;
        else right = mid;
      }
      return left;
    }
  }
  return hi;
}

async function applySeedCode(
  db: PrismaClient,
  storeId: string,
  seedCode: string,
): Promise<{ listingPrefix: string; listingSeq: number }> {
  const parts = parseShortCodeParts(seedCode);
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  if (!parts) {
    return { listingPrefix: store.listingPrefix || "A", listingSeq: store.listingSeq };
  }
  const listingPrefix = parts.prefix;
  const listingSeq = Math.max(store.listingSeq, parts.seq);
  const updated = await db.store.update({
    where: { id: storeId },
    data: { listingPrefix, listingSeq },
  });
  return { listingPrefix: updated.listingPrefix, listingSeq: updated.listingSeq };
}

/**
 * Import recent channel ads into Listing rows so the MAD agent can answer about old codes.
 * Uses forwardMessage probes (Bot API has no getChatHistory). Requires bot admin in channel
 * and ability to message scratchChatId (owner DM).
 */
export async function importChannelListings(
  db: PrismaClient,
  api: Api,
  storeId: string,
  options: ChannelSyncOptions,
): Promise<ChannelSyncResult> {
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store) throw new AppError("store missing", "ما لقيت المتجر.", "NOT_FOUND");
  if (!store.channelId) {
    throw new AppError("no channel", "اربط القناة أول بـ /setup أو /bind.", "NO_CHANNEL");
  }

  let listingPrefix = store.listingPrefix || "A";
  let listingSeq = store.listingSeq;

  if (options.seedCode) {
    const seeded = await applySeedCode(db, storeId, options.seedCode);
    listingPrefix = seeded.listingPrefix;
    listingSeq = seeded.listingSeq;
  }

  const walkLimit = options.walkLimit ?? DEFAULT_WALK;
  const onProgress = options.onProgress;

  // Prefer DB max channelMessageId as seed if none given
  let seedMessageId = options.seedMessageId;
  if (!seedMessageId) {
    const maxRow = await db.listing.findFirst({
      where: { storeId, channelMessageId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { channelMessageId: true },
    });
    const n = Number(maxRow?.channelMessageId);
    if (Number.isFinite(n) && n > 0) seedMessageId = n;
  }

  onProgress?.("نبحث عن آخر رسالة في القناة…");
  const high = await findChannelHighWatermark(
    api,
    store.channelId,
    options.scratchChatId,
    seedMessageId,
  );

  if (!high) {
    return {
      scanned: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      soldMarked: 0,
      highMessageId: null,
      listingSeq,
      listingPrefix,
      error: "ما قدرنا نقرأ القناة. تأكد إن البوت مشرف ويقدر يحوّل الرسائل، وأنك فاتح خاص مع البوت.",
    };
  }

  const seller = await getOrCreateSeller(db, store.ownerTelegramId);
  let scanned = 0;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let soldMarked = 0;
  let maxSeq = listingSeq;
  let bestPrefix = listingPrefix;

  const startId = high;
  const endId = Math.max(1, high - walkLimit + 1);

  onProgress?.(`نمسح من ${startId} نزولًا إلى ${endId}…`);

  for (let messageId = startId; messageId >= endId; messageId--) {
    scanned++;
    await sleep(PROBE_DELAY_MS);
    const probed = await probeMessage(api, store.channelId, messageId, options.scratchChatId);
    if (!probed) {
      skipped++;
      continue;
    }

    const ad = extractChannelAd(probed);
    if (!ad.looksLikeAd) {
      skipped++;
      continue;
    }

    // Listing rows need letter+digit short codes (F1442). Hash-only (#6930) is for sold mapping.
    const shortCode = ad.shortCode;
    if (!shortCode) {
      skipped++;
      continue;
    }

    const parts = parseShortCodeParts(shortCode);
    if (parts && parts.seq > maxSeq) {
      maxSeq = parts.seq;
      bestPrefix = parts.prefix;
    }

    const mediaFileId = ad.media?.fileId ?? "imported";
    const status = ad.looksSold ? "SOLD" : "PUBLISHED";
    const fields = {
      ...ad.extractedFields,
      ...(ad.identity?.startsWith("#") ? { channelHash: ad.identity } : {}),
      importedFromChannel: true,
    };

    const existing = await db.listing.findUnique({
      where: { storeId_shortCode: { storeId, shortCode } },
    });

    if (existing) {
      await db.listing.update({
        where: { id: existing.id },
        data: {
          description: ad.description || existing.description,
          price: ad.price > 0 ? new Prisma.Decimal(ad.price) : existing.price,
          telegramVideoFileId:
            mediaFileId !== "imported" ? mediaFileId : existing.telegramVideoFileId,
          channelMessageId: String(messageId),
          extractedFields: fields as Prisma.InputJsonValue,
          status:
            existing.status === "SOLD" || existing.status === "DELETED"
              ? existing.status
              : status,
        },
      });
      updated++;
      if (status === "SOLD" && existing.status !== "SOLD") soldMarked++;
    } else {
      await db.listing.create({
        data: {
          storeId,
          shortCode,
          sellerId: seller.id,
          telegramVideoFileId: mediaFileId,
          description: ad.description || `إعلان ${shortCode}`,
          price: new Prisma.Decimal(ad.price),
          status,
          channelMessageId: String(messageId),
          extractedFields: fields as Prisma.InputJsonValue,
        },
      });
      imported++;
      if (status === "SOLD") soldMarked++;
    }
  }

  const finalSeq = Math.max(listingSeq, maxSeq);
  const finalPrefix = bestPrefix || listingPrefix;
  await db.store.update({
    where: { id: storeId },
    data: { listingSeq: finalSeq, listingPrefix: finalPrefix },
  });

  await writeAudit(db, {
    actorId: store.ownerTelegramId,
    action: "channel.sync",
    entity: "Store",
    entityId: storeId,
    metadata: {
      scanned,
      imported,
      updated,
      skipped,
      highMessageId: high,
      listingSeq: finalSeq,
      listingPrefix: finalPrefix,
    },
  });

  return {
    scanned,
    imported,
    updated,
    skipped,
    soldMarked,
    highMessageId: high,
    listingSeq: finalSeq,
    listingPrefix: finalPrefix,
  };
}

/** Import a single forwarded channel post (owner fallback). */
export async function importForwardedChannelPost(
  db: PrismaClient,
  storeId: string,
  input: {
    channelId: string;
    messageId: number;
    caption: string;
    photo?: Array<{ file_id: string }>;
    video?: { file_id: string };
    animation?: { file_id: string };
    document?: { file_id: string; mime_type?: string };
  },
): Promise<{ shortCode: string; created: boolean } | null> {
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store?.channelId || store.channelId !== input.channelId) return null;

  const ad = extractChannelAd(input);
  const shortCode = ad.shortCode ?? normalizeShortCode(input.caption);
  if (!shortCode) return null;

  const seller = await getOrCreateSeller(db, store.ownerTelegramId);
  const mediaFileId = ad.media?.fileId ?? "imported";
  const status = ad.looksSold ? "SOLD" : "PUBLISHED";

  const existing = await db.listing.findUnique({
    where: { storeId_shortCode: { storeId, shortCode } },
  });

  if (existing) {
    await db.listing.update({
      where: { id: existing.id },
      data: {
        description: ad.description || existing.description,
        price: ad.price > 0 ? new Prisma.Decimal(ad.price) : existing.price,
        channelMessageId: String(input.messageId),
        telegramVideoFileId:
          mediaFileId !== "imported" ? mediaFileId : existing.telegramVideoFileId,
        status: existing.status === "DELETED" ? existing.status : status,
      },
    });
  } else {
    await db.listing.create({
      data: {
        storeId,
        shortCode,
        sellerId: seller.id,
        telegramVideoFileId: mediaFileId,
        description: ad.description || `إعلان ${shortCode}`,
        price: new Prisma.Decimal(ad.price),
        status,
        channelMessageId: String(input.messageId),
        extractedFields: { ...ad.extractedFields, importedFromChannel: true } as Prisma.InputJsonValue,
      },
    });
  }

  const parts = parseShortCodeParts(shortCode);
  if (parts) {
    await db.store.update({
      where: { id: storeId },
      data: {
        listingPrefix: parts.prefix,
        listingSeq: { set: Math.max(store.listingSeq, parts.seq) },
      },
    });
  }

  return { shortCode, created: !existing };
}

export { extractAdIdentity };
