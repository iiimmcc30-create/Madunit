import { strikeFullCaption } from "./owner-sold";
import { setSultanPrice, setMirrorPrice, isDmstorBot } from "../../domain/traders-ad";
import type { Api, Bot } from "grammy";
import { isSuperAdmin } from "../../config";
import { extractAdIdentity } from "../../domain/short-code";
import {
  detectAd,
  hasUsableTradersCaption,
  isSultanBot,
  isTradersGroupAdminNotice,
  isTradersMirrorBot,
  mediaFromMessage,
  rewriteTradersCaption,
} from "../../domain/traders-ad";
import {
  dequeueSultanPublish,
  enqueueSultanPublish,
  requeueSultanPublishFront,
  sultanPublishSlotsRemaining,
  tryAcquireSultanDrainLock,
  tryClaimSultanPublishSlot,
  type SultanQueuedPublish,
} from "../../domain/sultan-auto-publish";
import {
  detectTradersSold,
  extractSoldIdentity,
  formatChannelSoldCaption,
  cleanSoldReferenceText,
  type SoldEntity,
} from "../../domain/traders-sold";
import { createTelegramPublisher } from "../../infra/publisher";
import { GROUP_ANONYMOUS_BOT_ID } from "./group-bind";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";

const ALBUM_WAIT_MS = 1600;
const CAPTION_WAIT_MS = 120_000;
const CAPTION_POLL_MS = 2000;
const CAPWAIT_TTL_SEC = 60 * 60 * 24 * 14; // 14d — must outlive sold/edits (was 180s → republish bug)
const DEDUPE_TTL_SEC = 60 * 60 * 24 * 14; // 14 days
const SOLD_DEDUPE_TTL_SEC = 60 * 60 * 24 * 30;

type PendingMedia = {
  kind: "photo" | "video";
  fileId: string;
  messageId: number;
  fromUserId?: string;
};

type AlbumPending = {
  mediaGroupId: string;
  parts: Array<{
    messageId: number;
    kind: "photo" | "video";
    fileId: string;
    caption: string;
  }>;
};

function gated(deps: AppDeps): boolean {
  return isTradersMirrorBot(deps.botUsername);
}

async function loadStore(deps: AppDeps) {
  return deps.db.store.findUnique({
    where: { id: deps.storeId },
    select: {
      id: true,
      channelId: true,
      tradersGroupId: true,
      ownerUsername: true,
      ownerTelegramId: true,
      botUsername: true,
    },
  });
}


type StoreRow = NonNullable<Awaited<ReturnType<typeof loadStore>>>;

/** Bind one store to a traders group without unbinding peer stores that share it. */
export async function bindStoreToTradersGroup(
  db: AppDeps["db"],
  storeId: string,
  groupId: string,
): Promise<void> {
  await db.store.update({
    where: { id: storeId },
    data: { tradersGroupId: groupId },
  });
}

/** All stores mirroring from the same traders group (shared group support). */
export async function listStoresForTradersGroup(
  db: AppDeps["db"],
  groupId: string,
): Promise<StoreRow[]> {
  return db.store.findMany({
    where: { tradersGroupId: groupId },
    select: {
      id: true,
      channelId: true,
      tradersGroupId: true,
      ownerUsername: true,
      ownerTelegramId: true,
      botUsername: true,
    },
  });
}

/** True when this bot's store is bound to the chat and ready to mirror. */
export function storeMatchesTradersChat(
  store: StoreRow | null | undefined,
  chatId: string,
  botUsername?: string | null,
): store is StoreRow {
  if (!store?.tradersGroupId || !store.channelId) return false;
  if (chatId !== store.tradersGroupId) return false;
  if (!isTradersMirrorBot(store.botUsername) && !isTradersMirrorBot(botUsername)) {
    return false;
  }
  return true;
}

/**
 * Resolve stores that should mirror a traders-group message.
 * Multi-store: every store with this tradersGroupId is a candidate; each running
 * bot processes only its own row (deps.storeId) with its own token/channel.
 */
export async function resolveTradersMirrorStores(
  deps: AppDeps,
  chatId: string,
): Promise<StoreRow[]> {
  const all = await listStoresForTradersGroup(deps.db, chatId);
  return all.filter(
    (s) =>
      Boolean(s.channelId) &&
      (isTradersMirrorBot(s.botUsername) || isTradersMirrorBot(deps.botUsername)),
  );
}

async function loadMatchingMirrorStore(
  deps: AppDeps,
  chatId: string,
): Promise<StoreRow | null> {
  const matched = await resolveTradersMirrorStores(deps, chatId);
  // Prefer this bot's store among all peers sharing the group
  const mine = matched.find((s) => s.id === deps.storeId);
  if (mine) return mine;
  // Fallback: legacy single-store load when findMany empty but store still matches
  const store = await loadStore(deps);
  return storeMatchesTradersChat(store, chatId, deps.botUsername) ? store : null;
}


async function claimDedupe(
  deps: AppDeps,
  chatId: string,
  messageId: number,
): Promise<boolean> {
  const redis = deps.redis;
  if (!redis) return true;
  const key = `psb:traders:dedupe:${deps.storeId}:${chatId}:${messageId}`;
  try {
    const fresh = await redis.set(key, "1", "EX", DEDUPE_TTL_SEC, "NX");
    return Boolean(fresh);
  } catch {
    return true;
  }
}

async function claimSoldDedupe(
  deps: AppDeps,
  keyPart: string,
): Promise<boolean> {
  const redis = deps.redis;
  if (!redis) return true;
  const key = `psb:traders:sold:${deps.storeId}:${keyPart}`;
  try {
    const fresh = await redis.set(key, "1", "EX", SOLD_DEDUPE_TTL_SEC, "NX");
    return Boolean(fresh);
  } catch {
    return true;
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function pendingKey(storeId: string, chatId: string, messageId: number | string) {
  return `psb:traders:capwait:${storeId}:${chatId}:${messageId}`;
}

function captionKey(storeId: string, chatId: string, messageId: number | string) {
  return `psb:traders:capwait:cap:${storeId}:${chatId}:${messageId}`;
}

function doneKey(storeId: string, chatId: string, messageId: number | string) {
  return `psb:traders:capwait:done:${storeId}:${chatId}:${messageId}`;
}

function latestCapwaitKey(storeId: string, chatId: string) {
  return `psb:traders:capwait:latest:${storeId}:${chatId}`;
}

function fileDedupeKey(storeId: string, fileId: string) {
  return `psb:traders:file:${storeId}:${fileId}`;
}

const FILE_DEDUPE_TTL_SEC = 60 * 60; // 1 hour
const SULTAN_DRAIN_INTERVAL_MS = 30_000;

function albumPendingKey(storeId: string, chatId: string, mediaGroupId: string) {
  return `psb:traders:capwait:album:${storeId}:${chatId}:${mediaGroupId}`;
}

async function claimPublishDone(
  deps: AppDeps,
  chatId: string,
  messageId: number,
): Promise<boolean> {
  const redis = deps.redis;
  if (!redis) return true;
  try {
    const fresh = await redis.set(
      doneKey(deps.storeId, chatId, messageId),
      "1",
      "EX",
      CAPWAIT_TTL_SEC,
      "NX",
    );
    return Boolean(fresh);
  } catch {
    return true;
  }
}

async function isPublishDone(
  deps: AppDeps,
  chatId: string,
  messageId: number,
): Promise<boolean> {
  const redis = deps.redis;
  if (!redis) return false;
  try {
    return Boolean(await redis.get(doneKey(deps.storeId, chatId, messageId)));
  } catch {
    return false;
  }
}

/** Skip publish if this file_id was already mirrored recently (same video twice). */
async function claimFileDedupe(
  deps: AppDeps,
  fileId: string,
): Promise<boolean> {
  const redis = deps.redis;
  if (!redis || !fileId) return true;
  try {
    const fresh = await redis.set(
      fileDedupeKey(deps.storeId, fileId),
      "1",
      "EX",
      FILE_DEDUPE_TTL_SEC,
      "NX",
    );
    return Boolean(fresh);
  } catch {
    return true;
  }
}

async function setLatestCapwait(
  deps: AppDeps,
  chatId: string,
  messageId: number,
): Promise<void> {
  const redis = deps.redis;
  if (!redis) return;
  try {
    await redis.set(
      latestCapwaitKey(deps.storeId, chatId),
      String(messageId),
      "EX",
      CAPWAIT_TTL_SEC,
    );
  } catch {
    // ignore
  }
}

async function getLatestCapwait(
  deps: AppDeps,
  chatId: string,
): Promise<number | null> {
  const redis = deps.redis;
  if (!redis) return null;
  try {
    const raw = await redis.get(latestCapwaitKey(deps.storeId, chatId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function clearLatestCapwaitIf(
  deps: AppDeps,
  chatId: string,
  messageId: number,
): Promise<void> {
  const redis = deps.redis;
  if (!redis) return;
  try {
    const key = latestCapwaitKey(deps.storeId, chatId);
    const raw = await redis.get(key);
    if (raw && Number(raw) === messageId) {
      await redis.del(key);
    }
  } catch {
    // ignore
  }
}

/**
 * Cancel an open empty-caption wait so a later usable media/text can own the ad.
 * Marks done without publishing — waiter loops exit cleanly.
 */
async function cancelPendingCapwait(
  deps: AppDeps,
  chatId: string,
  messageId: number,
  reason: string,
): Promise<void> {
  if (await isPublishDone(deps, chatId, messageId)) return;
  await claimPublishDone(deps, chatId, messageId);
  await clearLatestCapwaitIf(deps, chatId, messageId);
  deps.logger.info(
    { storeId: deps.storeId, chatId, messageId, reason },
    "traders caption wait cancelled",
  );
}

async function setPendingMedia(
  deps: AppDeps,
  chatId: string,
  media: PendingMedia,
): Promise<void> {
  const redis = deps.redis;
  if (!redis) return;
  try {
    await redis.set(
      pendingKey(deps.storeId, chatId, media.messageId),
      JSON.stringify(media),
      "EX",
      CAPWAIT_TTL_SEC,
    );
    await setLatestCapwait(deps, chatId, media.messageId);
  } catch {
    // ignore
  }
}

async function getPendingMedia(
  deps: AppDeps,
  chatId: string,
  messageId: number,
): Promise<PendingMedia | null> {
  const redis = deps.redis;
  if (!redis) return null;
  try {
    const raw = await redis.get(pendingKey(deps.storeId, chatId, messageId));
    if (!raw) return null;
    return JSON.parse(raw) as PendingMedia;
  } catch {
    return null;
  }
}

async function setCaptionSignal(
  deps: AppDeps,
  chatId: string,
  messageId: number,
  caption: string,
): Promise<void> {
  const redis = deps.redis;
  if (!redis) return;
  try {
    await redis.set(
      captionKey(deps.storeId, chatId, messageId),
      caption,
      "EX",
      CAPWAIT_TTL_SEC,
    );
  } catch {
    // ignore
  }
}

async function getCaptionSignal(
  deps: AppDeps,
  chatId: string,
  messageId: number,
): Promise<string | null> {
  const redis = deps.redis;
  if (!redis) return null;
  try {
    return await redis.get(captionKey(deps.storeId, chatId, messageId));
  } catch {
    return null;
  }
}

async function setAlbumPending(
  deps: AppDeps,
  chatId: string,
  album: AlbumPending,
): Promise<void> {
  const redis = deps.redis;
  if (!redis) return;
  try {
    const key = albumPendingKey(deps.storeId, chatId, album.mediaGroupId);
    await redis.set(key, JSON.stringify(album), "EX", CAPWAIT_TTL_SEC);
    // Also register each part so edit/reply by message id finds the album
    for (const part of album.parts) {
      await redis.set(
        pendingKey(deps.storeId, chatId, part.messageId),
        JSON.stringify({
          kind: part.kind,
          fileId: part.fileId,
          messageId: part.messageId,
          mediaGroupId: album.mediaGroupId,
          album: true,
        }),
        "EX",
        CAPWAIT_TTL_SEC,
      );
    }
  } catch {
    // ignore
  }
}

async function getAlbumPending(
  deps: AppDeps,
  chatId: string,
  mediaGroupId: string,
): Promise<AlbumPending | null> {
  const redis = deps.redis;
  if (!redis) return null;
  try {
    const raw = await redis.get(albumPendingKey(deps.storeId, chatId, mediaGroupId));
    if (!raw) return null;
    return JSON.parse(raw) as AlbumPending;
  } catch {
    return null;
  }
}

async function saveMirrorMap(
  deps: AppDeps,
  input: {
    storeId: string;
    tradersGroupId: string;
    tradersMessageId: number | string;
    channelMessageId: number | string;
    caption: string;
  },
) {
  const shortCode = extractAdIdentity(input.caption);
  const snippet = cleanSoldReferenceText(input.caption, 200) || null;
  try {
    await deps.db.tradersMirrorMap.upsert({
      where: {
        storeId_tradersMessageId: {
          storeId: input.storeId,
          tradersMessageId: String(input.tradersMessageId),
        },
      },
      create: {
        storeId: input.storeId,
        tradersGroupId: input.tradersGroupId,
        tradersMessageId: String(input.tradersMessageId),
        channelMessageId: String(input.channelMessageId),
        shortCode,
        captionSnippet: snippet,
      },
      update: {
        channelMessageId: String(input.channelMessageId),
        shortCode: shortCode ?? undefined,
        captionSnippet: snippet ?? undefined,
        tradersGroupId: input.tradersGroupId,
      },
    });
  } catch (error) {
    deps.logger.error({ err: error, storeId: input.storeId }, "traders mirror map save failed");
  }
}

/**
 * Central publish: done-lock + dedupe + sendListing + mirror map + log.
 * Returns true if published.
 */
async function tryPublishMirror(
  ctx: BotContext,
  deps: AppDeps,
  store: StoreRow,
  input: {
    chatId: string;
    /** Primary traders message id used for done/dedupe locks */
    lockMessageId: number;
    /** All traders message ids to map to the channel post */
    mapMessageIds: number[];
    media: PendingMedia | PendingMedia[];
    caption: string;
  },
): Promise<boolean> {
  if (!store.channelId) return false;

  // Never mirror a sold/struck traders ad (would wipe channel sold mark with a fresh post)
  if (detectTradersSold(input.caption)) {
    deps.logger.info(
      {
        storeId: store.id,
        chatId: input.chatId,
        messageId: input.lockMessageId,
      },
      "traders mirror skip: caption is sold/struck",
    );
    await claimPublishDone(deps, input.chatId, input.lockMessageId);
    await clearLatestCapwaitIf(deps, input.chatId, input.lockMessageId);
    return false;
  }

  // Already mirrored or already sold → never publish a second channel copy
  for (const mid of input.mapMessageIds) {
    const existing = await deps.db.tradersMirrorMap.findUnique({
      where: {
        storeId_tradersMessageId: {
          storeId: store.id,
          tradersMessageId: String(mid),
        },
      },
    });
    if (existing?.soldNotifiedAt) {
      deps.logger.info(
        {
          storeId: store.id,
          chatId: input.chatId,
          messageId: mid,
          channelMessageId: existing.channelMessageId,
        },
        "traders mirror skip: already sold-notified",
      );
      await claimPublishDone(deps, input.chatId, input.lockMessageId);
      await clearLatestCapwaitIf(deps, input.chatId, input.lockMessageId);
      return false;
    }
    if (
      existing?.channelMessageId &&
      existing.channelMessageId !== "0" &&
      (await isPublishDone(deps, input.chatId, mid))
    ) {
      // done-lock still set → first publish in progress/done
      deps.logger.info(
        {
          storeId: store.id,
          chatId: input.chatId,
          messageId: mid,
          channelMessageId: existing.channelMessageId,
        },
        "traders mirror skip: already mirrored (done lock)",
      );
      return false;
    }
    if (existing?.channelMessageId && existing.channelMessageId !== "0") {
      deps.logger.info(
        {
          storeId: store.id,
          chatId: input.chatId,
          messageId: mid,
          channelMessageId: existing.channelMessageId,
        },
        "traders mirror skip: already mirrored",
      );
      await claimPublishDone(deps, input.chatId, input.lockMessageId);
      await clearLatestCapwaitIf(deps, input.chatId, input.lockMessageId);
      return false;
    }
  }

  // NEVER publish installments-only / empty body stubs
  if (
    !hasUsableTradersCaption(
      input.caption,
      store.ownerUsername,
      deps.botUsername,
    )
  ) {
    deps.logger.info(
      {
        storeId: store.id,
        chatId: input.chatId,
        messageId: input.lockMessageId,
      },
      "traders mirror skip: no usable caption",
    );
    // Mark done so waiters exit and we do not retry-spam
    await claimPublishDone(deps, input.chatId, input.lockMessageId);
    await clearLatestCapwaitIf(deps, input.chatId, input.lockMessageId);
    return false;
  }

  const parts = Array.isArray(input.media) ? input.media : [input.media];

  // file_id dedupe — same video must not become two channel posts
  for (const p of parts) {
    if (!(await claimFileDedupe(deps, p.fileId))) {
      deps.logger.info(
        {
          storeId: store.id,
          chatId: input.chatId,
          messageId: input.lockMessageId,
          fileId: p.fileId,
        },
        "traders mirror skip: file_id already mirrored",
      );
      await claimPublishDone(deps, input.chatId, input.lockMessageId);
      await clearLatestCapwaitIf(deps, input.chatId, input.lockMessageId);
      return false;
    }
  }

  if (!(await claimPublishDone(deps, input.chatId, input.lockMessageId))) {
    return false;
  }
  if (!(await claimDedupe(deps, input.chatId, input.lockMessageId))) {
    return false;
  }

  // sultan_sl_bot ONLY: max 10 ads / rolling 2h — queue FIFO when quota full.
  // dmstor_bot / sarhstoree_bot stay immediate (no rate limit).
  if (isSultanBot(deps.botUsername) && deps.redis) {
    const gotSlot = await tryClaimSultanPublishSlot(deps.redis, deps.storeId);
    if (!gotSlot) {
      const queued: SultanQueuedPublish = {
        chatId: input.chatId,
        lockMessageId: input.lockMessageId,
        mapMessageIds: input.mapMessageIds,
        media: parts.map((p) => ({
          kind: p.kind,
          fileId: p.fileId,
          messageId: p.messageId,
          fromUserId: p.fromUserId,
        })),
        caption: input.caption,
        enqueuedAt: Date.now(),
      };
      await enqueueSultanPublish(deps.redis, deps.storeId, queued);
      await clearLatestCapwaitIf(deps, input.chatId, input.lockMessageId);
      deps.logger.info(
        {
          storeId: store.id,
          chatId: input.chatId,
          messageId: input.lockMessageId,
          parts: parts.length,
        },
        "traders mirror queued (sultan 10/2h rate limit)",
      );
      return false;
    }
  }

  return sendMirroredAd(ctx.api, deps, store, {
    chatId: input.chatId,
    lockMessageId: input.lockMessageId,
    mapMessageIds: input.mapMessageIds,
    media: parts,
    caption: input.caption,
  });
}

/**
 * Actually send rewritten media+caption to the store channel and save mirror map.
 * Assumes done/dedupe/file locks (and sultan quota when applicable) already claimed.
 */
async function sendMirroredAd(
  api: Api,
  deps: AppDeps,
  store: StoreRow,
  input: {
    chatId: string;
    lockMessageId: number;
    mapMessageIds: number[];
    media: PendingMedia[];
    caption: string;
  },
): Promise<boolean> {
  if (!store.channelId) return false;
  const parts = input.media;
  const rewritten = rewriteTradersCaption(input.caption, store.ownerUsername, {
    botUsername: deps.botUsername,
  });
  const publisher = createTelegramPublisher(api);

  let channelMessageId: number;
  if (parts.length <= 1) {
    const only = parts[0]!;
    const sent = await publisher.sendListing(store.channelId, {
      videoFileId: only.fileId,
      caption: rewritten,
      mediaKind: only.kind,
    });
    channelMessageId = sent.messageId;
  } else {
    const media: Array<{
      type: "photo" | "video";
      media: string;
      caption?: string;
      parse_mode?: "HTML";
    }> = parts.map((p, idx) => {
      const base =
        idx === 0
          ? { media: p.fileId, caption: rewritten, parse_mode: "HTML" as const }
          : { media: p.fileId };
      return p.kind === "video"
        ? ({ type: "video" as const, ...base })
        : ({ type: "photo" as const, ...base });
    });
    const sent = await api.sendMediaGroup(store.channelId, media);
    channelMessageId = sent[0]?.message_id ?? input.lockMessageId;
  }

  for (const mid of input.mapMessageIds) {
    await saveMirrorMap(deps, {
      storeId: store.id,
      tradersGroupId: input.chatId,
      tradersMessageId: mid,
      channelMessageId,
      caption: rewritten,
    });
    if (mid !== input.lockMessageId) {
      await claimPublishDone(deps, input.chatId, mid);
    }
  }

  await clearLatestCapwaitIf(deps, input.chatId, input.lockMessageId);

  deps.logger.info(
    {
      storeId: store.id,
      chatId: input.chatId,
      messageId: input.lockMessageId,
      channelId: store.channelId,
      parts: parts.length,
    },
    parts.length > 1 ? "traders album mirrored" : "traders ad mirrored",
  );
  return true;
}

/**
 * Drain FIFO queue for sultan_sl_bot when rolling-window slots free up.
 * Idempotent + store-scoped via Redis drain lock.
 */
async function drainSultanPublishQueue(api: Api, deps: AppDeps): Promise<void> {
  if (!isSultanBot(deps.botUsername) || !deps.redis) return;
  if (!(await tryAcquireSultanDrainLock(deps.redis, deps.storeId))) return;

  const remaining = await sultanPublishSlotsRemaining(deps.redis, deps.storeId);
  if (remaining <= 0) return;

  const store = await loadStore(deps);
  if (!store?.channelId) return;

  let published = 0;
  while (published < remaining) {
    const item = await dequeueSultanPublish(deps.redis, deps.storeId);
    if (!item) break;

    // Drop if sold while waiting in queue
    if (detectTradersSold(item.caption)) {
      deps.logger.info(
        {
          storeId: deps.storeId,
          messageId: item.lockMessageId,
        },
        "sultan queue skip: caption sold while queued",
      );
      continue;
    }
    if (
      !hasUsableTradersCaption(
        item.caption,
        store.ownerUsername,
        deps.botUsername,
      )
    ) {
      deps.logger.info(
        {
          storeId: deps.storeId,
          messageId: item.lockMessageId,
        },
        "sultan queue skip: caption no longer usable",
      );
      continue;
    }

    const gotSlot = await tryClaimSultanPublishSlot(
      deps.redis,
      deps.storeId,
      Date.now(),
      `drain:${item.lockMessageId}:${item.enqueuedAt}`,
    );
    if (!gotSlot) {
      await requeueSultanPublishFront(deps.redis, deps.storeId, item);
      break;
    }

    try {
      await sendMirroredAd(api, deps, store, {
        chatId: item.chatId,
        lockMessageId: item.lockMessageId,
        mapMessageIds: item.mapMessageIds,
        media: item.media,
        caption: item.caption,
      });
      published += 1;
    } catch (error) {
      deps.logger.error(
        {
          err: error,
          storeId: deps.storeId,
          messageId: item.lockMessageId,
        },
        "sultan queued publish failed",
      );
      // Drop bad item (file_id / API error) so the queue is not stuck forever
    }
  }

  if (published > 0) {
    deps.logger.info(
      { storeId: deps.storeId, published, remaining },
      "sultan publish queue drained",
    );
  }
}

/**
 * Traders-group → store-channel ad mirror + sold detection.
 * HARD GATE: only allowlisted bots (dmstor_bot, sarhstoree_bot, sultan_sl_bot).
 * Others register nothing.
 */
export function registerTradersMirrorHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  if (!gated(deps)) return;

  // sultan_sl_bot: periodic drain of rate-limited publish queue
  if (isSultanBot(deps.botUsername) && deps.redis) {
    const tick = () => {
      void drainSultanPublishQueue(bot.api, deps).catch((error) => {
        deps.logger.error(
          { err: error, storeId: deps.storeId },
          "sultan queue drain failed",
        );
      });
    };
    tick();
    const timer = setInterval(tick, SULTAN_DRAIN_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
  }

  const groups = bot.chatType(["group", "supergroup"]);

  groups.command("bind_traders", async (ctx) => {
    const from = ctx.from;
    if (!from || from.id === GROUP_ANONYMOUS_BOT_ID || ctx.message?.sender_chat) {
      await ctx.reply(texts.bindAnonymous);
      return;
    }
    const actor = String(from.id);
    try {
      const store = await loadStore(deps);
      if (!store) {
        await ctx.reply("ما لقيت المتجر.");
        return;
      }
      if (!isTradersMirrorBot(store.botUsername) && !isTradersMirrorBot(deps.botUsername)) {
        return;
      }
      const superAdmin = isSuperAdmin(deps.config, actor);
      if (!superAdmin && store.ownerTelegramId !== actor) {
        await ctx.reply(texts.notOwner);
        return;
      }
      const groupId = String(ctx.chat.id);
      // Shared traders group: do not clear other stores bound to the same groupId
      await bindStoreToTradersGroup(deps.db, store.id, groupId);
      await ctx.reply(texts.tradersBindOk(groupId));
      deps.logger.info({ storeId: store.id, groupId }, "traders group bound");
    } catch (error) {
      deps.logger.error({ err: error, storeId: deps.storeId }, "bind_traders failed");
      await ctx.reply(texts.tradersBindFail);
    }
  });

  groups.command("unbind_traders", async (ctx) => {
    const from = ctx.from;
    if (!from || from.id === GROUP_ANONYMOUS_BOT_ID || ctx.message?.sender_chat) {
      await ctx.reply(texts.bindAnonymous);
      return;
    }
    const actor = String(from.id);
    try {
      const store = await loadStore(deps);
      if (!store) return;
      if (!isTradersMirrorBot(store.botUsername) && !isTradersMirrorBot(deps.botUsername)) {
        return;
      }
      const superAdmin = isSuperAdmin(deps.config, actor);
      if (!superAdmin && store.ownerTelegramId !== actor) {
        await ctx.reply(texts.notOwner);
        return;
      }
      if (!store.tradersGroupId) {
        await ctx.reply(texts.tradersUnbindNone);
        return;
      }
      if (String(ctx.chat.id) !== store.tradersGroupId) {
        await ctx.reply(texts.tradersUnbindWrongGroup(store.tradersGroupId));
        return;
      }
      await deps.db.store.update({
        where: { id: store.id },
        data: { tradersGroupId: null },
      });
      await ctx.reply(texts.tradersUnbindOk);
    } catch (error) {
      deps.logger.error({ err: error, storeId: deps.storeId }, "unbind_traders failed");
      await ctx.reply("صار خطأ أثناء فك الربط.");
    }
  });

  bot.chatType("private").on("message:text", async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (!/(اربط\s*قروب\s*التجار|أربط\s*قروب\s*التجار|ربط\s*قروب\s*التجار|bind\s*traders)/i.test(text)) {
      await next();
      return;
    }
    const actor = String(ctx.from?.id ?? "");
    const store = await loadStore(deps);
    if (!store) {
      await next();
      return;
    }
    const allowed =
      isSuperAdmin(deps.config, actor) || store.ownerTelegramId === actor;
    if (!allowed) {
      await next();
      return;
    }
    await ctx.reply(texts.tradersBindHint);
  });

  groups.on(["message:photo", "message:video", "message:animation", "message:document"], async (ctx, next) => {
    try {
      await handleGroupMedia(ctx, deps);
    } catch (error) {
      deps.logger.error({ err: error, storeId: deps.storeId }, "traders mirror failed");
    }
    await next();
  });

  // New text: caption-wait reply + sold notices
  groups.on("message:text", async (ctx, next) => {
    try {
      const msg = ctx.message;
      // Sultan: رد تخفيض من التاجر على إعلانه → «تخفيض الحد لـ N» بالقناة (أبدًا إعلان جديد)
      if ((isSultanBot(deps.botUsername) || isDmstorBot(deps.botUsername)) && parseTraderReduction(msg?.text ?? "") != null) {
        await handleSultanReduction(ctx, deps, msg);
        await next();
        return;
      }
      await handleCaptionReply(ctx, deps, msg);
      await handleSoldCandidate(
        ctx,
        deps,
        msg?.text ?? "",
        msg?.message_id,
        "new",
        msg?.entities as SoldEntity[] | undefined,
        msg?.reply_to_message,
      );
    } catch (error) {
      deps.logger.error({ err: error, storeId: deps.storeId }, "traders sold (new) failed");
    }
    await next();
  });

  // Edited messages: caption-wait publish + sold marks
  groups.on("edited_message", async (ctx, next) => {
    try {
      const edited = ctx.editedMessage;
      if (!edited) {
        await next();
        return;
      }
      const text = edited.caption ?? edited.text ?? "";
      const entities = (edited.caption_entities ?? edited.entities) as SoldEntity[] | undefined;

      // Sold takes priority — skip mirror publish when this is a sold mark
      if (detectTradersSold(text, entities)) {
        await handleSoldCandidate(
          ctx,
          deps,
          text,
          edited.message_id,
          "edit",
          entities,
          edited.reply_to_message,
        );
      } else {
        await handleCaptionEdit(ctx, deps, edited);
      }
    } catch (error) {
      deps.logger.error({ err: error, storeId: deps.storeId }, "traders sold (edit) failed");
    }
    await next();
  });
}

async function publishPendingWithCaption(
  ctx: BotContext,
  deps: AppDeps,
  store: StoreRow,
  chatId: string,
  pending: PendingMedia,
  caption: string,
  targetMessageId: number,
) {
  await setCaptionSignal(deps, chatId, targetMessageId, caption);

  // Album part? Prefer whole album publish
  const pendingRaw = deps.redis
    ? await deps.redis.get(pendingKey(deps.storeId, chatId, targetMessageId)).catch(() => null)
    : null;
  let mediaGroupId: string | undefined;
  if (pendingRaw) {
    try {
      const parsed = JSON.parse(pendingRaw) as { mediaGroupId?: string; album?: boolean };
      if (parsed.album && parsed.mediaGroupId) mediaGroupId = parsed.mediaGroupId;
    } catch {
      // ignore
    }
  }

  if (mediaGroupId) {
    const album = await getAlbumPending(deps, chatId, mediaGroupId);
    if (album?.parts?.length) {
      const firstId = Math.min(...album.parts.map((p) => p.messageId));
      await tryPublishMirror(ctx, deps, store, {
        chatId,
        lockMessageId: firstId,
        mapMessageIds: album.parts.map((p) => p.messageId),
        media: album.parts.map((p) => ({
          kind: p.kind,
          fileId: p.fileId,
          messageId: p.messageId,
        })),
        caption,
      });
      return;
    }
  }

  await tryPublishMirror(ctx, deps, store, {
    chatId,
    lockMessageId: pending.messageId,
    mapMessageIds: [pending.messageId],
    media: pending,
    caption,
  });
}

async function handleCaptionReply(
  ctx: BotContext,
  deps: AppDeps,
  msg:
    | {
        text?: string;
        message_id: number;
        reply_to_message?: { message_id: number } | null;
      }
    | undefined,
) {
  if (!msg?.text || !ctx.chat) return;
  const chatId = String(ctx.chat.id);

  const store = await loadMatchingMirrorStore(deps, chatId);
  if (!store) return;

  if (isTradersGroupAdminNotice(msg.text)) {
    return;
  }
  if (
    !hasUsableTradersCaption(msg.text, store.ownerUsername, deps.botUsername)
  ) {
    return;
  }
  // Sold chatter must not bind as caption / republish
  if (detectTradersSold(msg.text)) {
    return;
  }

  // Prefer explicit reply-to pending media
  let targetId: number | null = msg.reply_to_message?.message_id ?? null;
  let pending: PendingMedia | null = targetId
    ? await getPendingMedia(deps, chatId, targetId)
    : null;

  // Non-reply listing body → bind to latest open empty-media wait in this chat
  if (!pending) {
    const latestId = await getLatestCapwait(deps, chatId);
    if (latestId != null) {
      if (await isPublishDone(deps, chatId, latestId)) {
        await clearLatestCapwaitIf(deps, chatId, latestId);
      } else {
        pending = await getPendingMedia(deps, chatId, latestId);
        if (pending) targetId = latestId;
      }
    }
  }

  if (!pending || targetId == null) return;

  deps.logger.info(
    {
      storeId: store.id,
      chatId,
      pendingMessageId: targetId,
      textMessageId: msg.message_id,
      viaReply: Boolean(msg.reply_to_message),
    },
    "traders caption bound to pending media",
  );

  await publishPendingWithCaption(ctx, deps, store, chatId, pending, msg.text, targetId);
}

async function handleCaptionEdit(
  ctx: BotContext,
  deps: AppDeps,
  edited: {
    message_id: number;
    caption?: string;
    text?: string;
    photo?: Array<{ file_id: string }>;
    video?: { file_id: string };
    animation?: { file_id: string };
    document?: { file_id: string; mime_type?: string };
    media_group_id?: string;
  },
) {
  if (!ctx.chat) return;
  const chatId = String(ctx.chat.id);
  const caption = edited.caption ?? edited.text ?? "";
  if (!caption.trim()) return;
  if (isTradersGroupAdminNotice(caption)) return;

  const store = await loadMatchingMirrorStore(deps, chatId);
  if (!store) return;

  if (
    !hasUsableTradersCaption(caption, store.ownerUsername, deps.botUsername)
  ) {
    return;
  }
  // Defensive: sold/struck edits are handled above; never republish here
  if (detectTradersSold(caption)) {
    return;
  }

  // Only complete an open caption-wait / album wait.
  // Never treat an edit on an old pre-bot (or already-aged) media as a brand-new ad —
  // that was republishing sold/struck old listings into the channel.
  const pending = await getPendingMedia(deps, chatId, edited.message_id);
  if (await isPublishDone(deps, chatId, edited.message_id)) return;

  await setCaptionSignal(deps, chatId, edited.message_id, caption);

  // Album wait?
  let mediaGroupId = edited.media_group_id ? String(edited.media_group_id) : undefined;
  if (!mediaGroupId && deps.redis) {
    const raw = await deps.redis
      .get(pendingKey(deps.storeId, chatId, edited.message_id))
      .catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { mediaGroupId?: string; album?: boolean };
        if (parsed.album && parsed.mediaGroupId) mediaGroupId = parsed.mediaGroupId;
      } catch {
        // ignore
      }
    }
  }

  if (mediaGroupId) {
    const album = await getAlbumPending(deps, chatId, mediaGroupId);
    if (album?.parts?.length) {
      const firstId = Math.min(...album.parts.map((p) => p.messageId));
      await tryPublishMirror(ctx, deps, store, {
        chatId,
        lockMessageId: firstId,
        mapMessageIds: album.parts.map((p) => p.messageId),
        media: album.parts.map((p) => ({
          kind: p.kind,
          fileId: p.fileId,
          messageId: p.messageId,
        })),
        caption,
      });
      return;
    }
  }

  if (!pending) {
    deps.logger.info(
      { storeId: store.id, chatId, messageId: edited.message_id },
      "traders mirror skip: caption edit without open wait (old/untracked ad)",
    );
    return;
  }

  await tryPublishMirror(ctx, deps, store, {
    chatId,
    lockMessageId: pending.messageId,
    mapMessageIds: [pending.messageId],
    media: pending,
    caption,
  });
}

function escapeHtmlLite(t: string): string {
  return (t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** «مخفض ب1000» / «مخفض 1000» / «تخفيض 1000» / «نزلته 1000» / «خفضته لـ 1000» / «- 1000 📎» → 1000 */
export function parseTraderReduction(text: string): number | null {
  const t = normalizeDigitsLite(text ?? "").trim();
  if (!t || t.length > 60 || /[؟?]/.test(t)) return null;
  const dash = t.match(/^[\-–—]\s*(\d[\d,]{1,7})\s*(?:[\p{Extended_Pictographic}\uFE0F\u200D]\s*)*$/u);
  const word = /(مخفض|مخفّض|تخفيض|خفضته|خفّضته|خفضت|خفض|نزلته|نزّلته|نزلت|نزل\s*سعره|نزلناه|ارخصته)/i.test(t)
    ? t.match(/(\d[\d,]{1,7})/)
    : null;
  const m = dash ?? word;
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return n >= 10 ? n : null;
}

function normalizeDigitsLite(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

/** Sultan: تخفيض من قروب التجار → رد بالقناة + تعديل «بـ N» بالكابشن */
async function handleSultanReduction(ctx: BotContext, deps: AppDeps, msg: any) {
  const price = parseTraderReduction(msg?.text ?? "");
  if (price == null || !ctx.chat) return;
  const store = await loadMatchingMirrorStore(deps, String(ctx.chat.id));
  if (!store?.channelId) return;
  const reply = msg?.reply_to_message;
  if (!reply?.message_id) {
    // بدون رد: ما نخزن صاحب الإعلان بالخريطة → غامض، نتجاهل بهدوء
    deps.logger.info({ storeId: store.id, messageId: msg?.message_id, price }, "sultan reduction skip: not a reply");
    await claimPublishDone(deps, String(ctx.chat.id), msg.message_id);
    return;
  }
  await claimPublishDone(deps, String(ctx.chat.id), msg.message_id);
  const map = await deps.db.tradersMirrorMap.findUnique({
    where: { storeId_tradersMessageId: { storeId: store.id, tradersMessageId: String(reply.message_id) } },
  });
  const chId = map?.channelMessageId && map.channelMessageId !== "0" ? Number(map.channelMessageId) : NaN;
  if (!map || !Number.isFinite(chId) || map.soldNotifiedAt) {
    deps.logger.info({ storeId: store.id, replyTo: reply.message_id }, "sultan reduction skip: no mirrored ad");
    return;
  }
  if (reply.from?.id && msg.from?.id && reply.from.id !== msg.from.id) {
    deps.logger.info({ storeId: store.id, replyTo: reply.message_id }, "sultan reduction skip: not ad owner");
    return;
  }
  await ctx.api.sendMessage(store.channelId, `تخفيض الحد لـ ${price}`, {
    reply_parameters: { message_id: chId, allow_sending_without_reply: true },
  });
  const source = reply.caption ?? reply.text ?? "";
  if (source.trim()) {
    const rewritten = rewriteTradersCaption(source, store.ownerUsername, { botUsername: deps.botUsername });
    const updated = isSultanBot(deps.botUsername) ? setSultanPrice(rewritten, price) : setMirrorPrice(rewritten, price);
    try {
      await ctx.api.editMessageCaption(store.channelId, chId, { caption: updated, parse_mode: "HTML" });
    } catch {
      try {
        await ctx.api.editMessageText(store.channelId, chId, updated, { parse_mode: "HTML" });
      } catch (error) {
        deps.logger.warn({ err: error, storeId: store.id }, "sultan reduction caption edit failed");
      }
    }
  }
  if (map.shortCode && !map.shortCode.startsWith("#")) {
    try {
      const l = await deps.db.listing.findFirst({ where: { storeId: store.id, shortCode: map.shortCode } });
      if (l) await deps.db.listing.update({ where: { id: l.id }, data: { price } });
    } catch {
      /* no listing row */
    }
  }
  deps.logger.info({ storeId: store.id, channelMessageId: chId, price }, "sultan reduction posted");
}

async function handleSoldCandidate(
  ctx: BotContext,
  deps: AppDeps,
  text: string,
  tradersMessageId: number | undefined,
  kind: "new" | "edit",
  entities?: SoldEntity[] | null,
  replyToMsg?: {
    message_id: number;
    caption?: string;
    text?: string;
    caption_entities?: SoldEntity[];
    entities?: SoldEntity[];
  } | null,
) {
  if (!tradersMessageId || !ctx.chat) return;
  if (isTradersGroupAdminNotice(text)) return;
  if (!detectTradersSold(text, entities)) return;

  const store = await loadMatchingMirrorStore(deps, String(ctx.chat.id));
  if (!store) return;

  // Prefer the original traders ad when sold notice is a reply («تم البيع» on the ad)
  const originalTradersMessageId = replyToMsg?.message_id ?? tradersMessageId;
  const replyCaption = replyToMsg
    ? (replyToMsg.caption ?? replyToMsg.text ?? "")
    : "";
  const identitySource = replyCaption || text;
  const identity =
    extractSoldIdentity(identitySource) ||
    extractSoldIdentity(text) ||
    null;

  // Resolve mirror map: reply/original ad id first, then current message id, then shortCode
  let map = await deps.db.tradersMirrorMap.findUnique({
    where: {
      storeId_tradersMessageId: {
        storeId: store.id,
        tradersMessageId: String(originalTradersMessageId),
      },
    },
  });
  if (
    !map &&
    originalTradersMessageId !== tradersMessageId
  ) {
    map = await deps.db.tradersMirrorMap.findUnique({
      where: {
        storeId_tradersMessageId: {
          storeId: store.id,
          tradersMessageId: String(tradersMessageId),
        },
      },
    });
  }
  if (!map && identity) {
    map = await deps.db.tradersMirrorMap.findFirst({
      where: { storeId: store.id, shortCode: identity },
      orderBy: { createdAt: "desc" },
    });
  }

  const channelMessageIdRaw = map?.channelMessageId;
  const channelMessageIdNum =
    channelMessageIdRaw && channelMessageIdRaw !== "0"
      ? Number(channelMessageIdRaw)
      : NaN;
  const hasChannelTarget = Number.isFinite(channelMessageIdNum) && channelMessageIdNum > 0;

  if (!map || !hasChannelTarget) {
    deps.logger.info(
      {
        storeId: store.id,
        tradersMessageId,
        originalTradersMessageId,
        identity,
        kind,
        hasReply: Boolean(replyToMsg),
      },
      "traders sold skip: no mirrored channel ad",
    );
    // Pre-bot / never-mirrored ad marked sold — lock so an edit cannot publish it as new
    await claimPublishDone(deps, String(ctx.chat.id), originalTradersMessageId);
    if (tradersMessageId !== originalTradersMessageId) {
      await claimPublishDone(deps, String(ctx.chat.id), tradersMessageId);
    }
    return;
  }

  if (map.soldNotifiedAt) return;

  // Dedupe by channel message / original traders ad — not the sold chatter id alone
  const dedupeKey = `ch:${channelMessageIdRaw}`;
  const dedupeKeyAlt = `tm:${originalTradersMessageId}`;
  if (!(await claimSoldDedupe(deps, dedupeKey))) return;
  if (dedupeKey !== dedupeKeyAlt) {
    await claimSoldDedupe(deps, dedupeKeyAlt);
  }
  if (identity) {
    await claimSoldDedupe(deps, `id:${identity}`);
  }

  // Prefer full ad text (reply target or edit-on-ad), rewritten like the mirror caption
  const sourcePlain = (replyCaption && replyCaption.trim()) || (kind === "edit" ? text : "") || "";
  let soldCaption: string;
  if (sourcePlain.trim()) {
    const rewritten = rewriteTradersCaption(sourcePlain, store.ownerUsername, {
      botUsername: deps.botUsername,
    });
    soldCaption = isSultanBot(deps.botUsername)
      ? strikeFullCaption(rewritten)
      : formatChannelSoldCaption(rewritten, identity ?? map.shortCode, {
          alreadyEscaped: true,
        });
  } else {
    const refText =
      map.captionSnippet ||
      cleanSoldReferenceText(text) ||
      identity ||
      `رسالة ${originalTradersMessageId}`;
    soldCaption = isSultanBot(deps.botUsername)
      ? strikeFullCaption(escapeHtmlLite(refText))
      : formatChannelSoldCaption(refText, identity ?? map.shortCode);
  }
  const channelId = store.channelId;
  if (!channelId) return;

  // Edit mirrored channel ad in place: strikethrough caption + «تم البيع ✅» — never thank-you / re-publish
  let edited = false;
  try {
    await ctx.api.editMessageCaption(channelId, channelMessageIdNum, {
      caption: soldCaption,
      parse_mode: "HTML",
    });
    edited = true;
  } catch (captionErr) {
    try {
      await ctx.api.editMessageText(channelId, channelMessageIdNum, soldCaption, {
        parse_mode: "HTML",
      });
      edited = true;
    } catch (textErr) {
      deps.logger.warn(
        { err: textErr ?? captionErr, storeId: store.id, channelMessageId: channelMessageIdNum },
        "traders sold channel edit failed",
      );
      return;
    }
  }

  await deps.db.tradersMirrorMap.update({
    where: { id: map.id },
    data: { soldNotifiedAt: new Date() },
  });
  if (isSultanBot(deps.botUsername)) {
    try {
      await ctx.api.sendMessage(channelId, "تم البيع ✅", {
        reply_parameters: { message_id: channelMessageIdNum, allow_sending_without_reply: true },
      });
    } catch (error) {
      deps.logger.warn({ err: error, storeId: store.id }, "sultan sold reply failed");
    }
  }

  // If a Listing exists for a letter short code, mark it sold
  const letterCode = identity && !identity.startsWith("#") ? identity : null;
  if (letterCode) {
    try {
      await deps.listings.markSoldAsSystem(letterCode, store.ownerTelegramId, store.id);
    } catch {
      // listing may not exist — channel notice is enough
    }
  }

  deps.logger.info(
    {
      storeId: store.id,
      tradersMessageId,
      originalTradersMessageId,
      channelMessageId: channelMessageIdNum,
      identity,
      kind,
      edited,
      channelId,
    },
    "traders sold marked on channel",
  );
}

async function handleGroupMedia(ctx: BotContext, deps: AppDeps) {
  const message = ctx.message;
  if (!message || !ctx.chat) return;

  if (message.from?.is_bot) return;
  if (deps.botUsername && message.from?.username) {
    if (
      message.from.username.replace(/^@/, "").toLowerCase() ===
      deps.botUsername.replace(/^@/, "").toLowerCase()
    ) {
      return;
    }
  }

  // If this media caption is already a sold notice, route to sold handler
  const captionEarly = message.caption ?? "";
  const captionEntities = message.caption_entities as SoldEntity[] | undefined;
  if (isTradersGroupAdminNotice(captionEarly)) {
    deps.logger.info(
      { storeId: deps.storeId, chatId: ctx.chat?.id, messageId: message.message_id },
      "traders mirror skip: group admin cleanup notice",
    );
    return;
  }
  if (detectTradersSold(captionEarly, captionEntities)) {
    await handleSoldCandidate(
      ctx,
      deps,
      captionEarly,
      message.message_id,
      "new",
      captionEntities,
      message.reply_to_message,
    );
    return;
  }

  const store = await loadMatchingMirrorStore(deps, String(ctx.chat.id));
  if (!store) return;

  const media = mediaFromMessage(message);
  if (!media) return;

  const caption = message.caption ?? message.text ?? "";
  const mediaGroupId = message.media_group_id;

  if (mediaGroupId) {
    await bufferAlbumItem(ctx, deps, store, {
      mediaGroupId: String(mediaGroupId),
      chatId: String(ctx.chat.id),
      messageId: message.message_id,
      kind: media.kind,
      fileId: media.fileId,
      caption,
    });
    return;
  }

  if (!detectAd({ hasPhoto: media.kind === "photo", hasVideo: media.kind === "video", caption })) {
    deps.logger.info(
      { storeId: store.id, chatId: ctx.chat.id, messageId: message.message_id },
      "traders mirror skip: not listing-like",
    );
    return;
  }

  const chatId = String(ctx.chat.id);
  const fromUserId = message.from?.id != null ? String(message.from.id) : undefined;
  const pending: PendingMedia = {
    kind: media.kind,
    fileId: media.fileId,
    messageId: message.message_id,
    fromUserId,
  };

  // Usable caption → cancel any prior empty pending for this chat, publish once
  if (hasUsableTradersCaption(caption, store.ownerUsername, deps.botUsername)) {
    const latestId = await getLatestCapwait(deps, chatId);
    if (latestId != null && latestId !== message.message_id) {
      const prior = await getPendingMedia(deps, chatId, latestId);
      const sameUser =
        !fromUserId || !prior?.fromUserId || prior.fromUserId === fromUserId;
      if (prior && sameUser && !(await isPublishDone(deps, chatId, latestId))) {
        await cancelPendingCapwait(
          deps,
          chatId,
          latestId,
          "newer media with usable caption",
        );
      }
    }
    await tryPublishMirror(ctx, deps, store, {
      chatId,
      lockMessageId: message.message_id,
      mapMessageIds: [message.message_id],
      media: pending,
      caption,
    });
    return;
  }

  // No redis → cannot wait; never publish unusable stub
  if (!deps.redis) {
    deps.logger.info(
      { storeId: store.id, chatId, messageId: message.message_id },
      "traders mirror skip: no usable caption",
    );
    return;
  }

  // Wait ≤2 minutes for caption edit OR text reply OR next listing text in group
  await setPendingMedia(deps, chatId, pending);
  deps.logger.info(
    { storeId: store.id, chatId, messageId: message.message_id },
    "traders caption wait started",
  );

  const deadline = Date.now() + CAPTION_WAIT_MS;
  let signalCaption: string | null = null;
  while (Date.now() < deadline) {
    if (await isPublishDone(deps, chatId, message.message_id)) {
      return; // edit/reply/cancel already handled
    }
    signalCaption = await getCaptionSignal(deps, chatId, message.message_id);
    if (
      signalCaption != null &&
      signalCaption !== "" &&
      hasUsableTradersCaption(signalCaption, store.ownerUsername, deps.botUsername)
    ) {
      break;
    }
    await sleep(CAPTION_POLL_MS);
  }

  if (await isPublishDone(deps, chatId, message.message_id)) {
    return;
  }

  const finalCaption = signalCaption || caption || "";
  if (
    !hasUsableTradersCaption(finalCaption, store.ownerUsername, deps.botUsername)
  ) {
    deps.logger.info(
      { storeId: store.id, chatId, messageId: message.message_id },
      "traders mirror skip: no usable caption",
    );
    await claimPublishDone(deps, chatId, message.message_id);
    await clearLatestCapwaitIf(deps, chatId, message.message_id);
    return;
  }

  await tryPublishMirror(ctx, deps, store, {
    chatId,
    lockMessageId: message.message_id,
    mapMessageIds: [message.message_id],
    media: pending,
    caption: finalCaption,
  });
}

async function bufferAlbumItem(
  ctx: BotContext,
  deps: AppDeps,
  store: StoreRow,
  item: {
    mediaGroupId: string;
    chatId: string;
    messageId: number;
    kind: "photo" | "video";
    fileId: string;
    caption: string;
  },
) {
  const redis = deps.redis;
  if (!redis || !store.channelId) {
    if (
      detectAd({
        hasPhoto: item.kind === "photo",
        hasVideo: item.kind === "video",
        hasMediaGroup: true,
        caption: item.caption,
      }) &&
      hasUsableTradersCaption(item.caption, store.ownerUsername, deps.botUsername)
    ) {
      await tryPublishMirror(ctx, deps, store, {
        chatId: item.chatId,
        lockMessageId: item.messageId,
        mapMessageIds: [item.messageId],
        media: {
          kind: item.kind,
          fileId: item.fileId,
          messageId: item.messageId,
        },
        caption: item.caption,
      });
    } else if (!hasUsableTradersCaption(item.caption, store.ownerUsername, deps.botUsername)) {
      deps.logger.info(
        { storeId: store.id, chatId: item.chatId, messageId: item.messageId },
        "traders mirror skip: no usable caption",
      );
    }
    return;
  }

  const listKey = `psb:traders:album:${deps.storeId}:${item.chatId}:${item.mediaGroupId}`;
  const lockKey = `${listKey}:lock`;
  const payload = JSON.stringify({
    messageId: item.messageId,
    kind: item.kind,
    fileId: item.fileId,
    caption: item.caption,
  });
  await redis.rpush(listKey, payload);
  await redis.expire(listKey, 30);

  const gotLock = await redis.set(lockKey, "1", "EX", 10, "NX");
  if (!gotLock) return;

  await sleep(ALBUM_WAIT_MS);

  const raw = await redis.lrange(listKey, 0, -1);
  await redis.del(listKey, lockKey);
  if (!raw.length) return;

  type Part = { messageId: number; kind: "photo" | "video"; fileId: string; caption: string };
  const parts: Part[] = [];
  for (const row of raw) {
    try {
      parts.push(JSON.parse(row) as Part);
    } catch {
      // skip bad
    }
  }
  if (!parts.length) return;

  const caption = parts.map((p) => p.caption).find((c) => c && c.trim()) ?? "";
  if (isTradersGroupAdminNotice(caption)) {
    deps.logger.info(
      { storeId: store.id, chatId: item.chatId, mediaGroupId: item.mediaGroupId },
      "traders mirror skip album: group admin cleanup notice",
    );
    return;
  }
  const hasPhoto = parts.some((p) => p.kind === "photo");
  const hasVideo = parts.some((p) => p.kind === "video");
  if (!detectAd({ hasPhoto, hasVideo, hasMediaGroup: true, caption })) {
    deps.logger.info(
      { storeId: store.id, chatId: item.chatId, mediaGroupId: item.mediaGroupId },
      "traders mirror skip album: not listing-like",
    );
    return;
  }

  const firstId = Math.min(...parts.map((p) => p.messageId));
  const mediaParts: PendingMedia[] = parts.map((p) => ({
    kind: p.kind,
    fileId: p.fileId,
    messageId: p.messageId,
  }));
  const mapIds = parts.map((p) => p.messageId);

  // Usable caption → publish album immediately
  if (hasUsableTradersCaption(caption, store.ownerUsername, deps.botUsername)) {
    await tryPublishMirror(ctx, deps, store, {
      chatId: item.chatId,
      lockMessageId: firstId,
      mapMessageIds: mapIds,
      media: mediaParts,
      caption,
    });
    return;
  }

  // Register album pending + per-part keys, wait for caption signal on any part
  await setAlbumPending(deps, item.chatId, {
    mediaGroupId: item.mediaGroupId,
    parts,
  });
  await setLatestCapwait(deps, item.chatId, firstId);
  deps.logger.info(
    {
      storeId: store.id,
      chatId: item.chatId,
      mediaGroupId: item.mediaGroupId,
      parts: parts.length,
    },
    "traders album caption wait started",
  );

  const deadline = Date.now() + CAPTION_WAIT_MS;
  let signalCaption: string | null = null;
  while (Date.now() < deadline) {
    if (await isPublishDone(deps, item.chatId, firstId)) {
      return;
    }
    for (const p of parts) {
      if (await isPublishDone(deps, item.chatId, p.messageId)) {
        return;
      }
      const sig = await getCaptionSignal(deps, item.chatId, p.messageId);
      if (
        sig != null &&
        sig !== "" &&
        hasUsableTradersCaption(sig, store.ownerUsername, deps.botUsername)
      ) {
        signalCaption = sig;
        break;
      }
    }
    if (signalCaption != null) break;
    await sleep(CAPTION_POLL_MS);
  }

  if (await isPublishDone(deps, item.chatId, firstId)) {
    return;
  }

  const finalCaption = signalCaption || caption || "";
  if (
    !hasUsableTradersCaption(finalCaption, store.ownerUsername, deps.botUsername)
  ) {
    deps.logger.info(
      {
        storeId: store.id,
        chatId: item.chatId,
        mediaGroupId: item.mediaGroupId,
        messageId: firstId,
      },
      "traders mirror skip: no usable caption",
    );
    await claimPublishDone(deps, item.chatId, firstId);
    for (const p of parts) {
      if (p.messageId !== firstId) {
        await claimPublishDone(deps, item.chatId, p.messageId);
      }
    }
    await clearLatestCapwaitIf(deps, item.chatId, firstId);
    return;
  }

  await tryPublishMirror(ctx, deps, store, {
    chatId: item.chatId,
    lockMessageId: firstId,
    mapMessageIds: mapIds,
    media: mediaParts,
    caption: finalCaption,
  });
}
