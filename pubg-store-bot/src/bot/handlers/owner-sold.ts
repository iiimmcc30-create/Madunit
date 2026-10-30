import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { isSuperAdmin } from "../../config";
import { detectInquiryCode, parseForwardedChannel } from "../../domain/inquiry-detect";
import { buildListingCaption, toListingView } from "../../services/listing";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { isPrivateDirectPublishBot } from "./private-direct-publish";

export const OWNER_SOLD_INTENT =
  /^(?:اشطب|اشطبه|اشطبها|اشطب\s*(?:على|ع|عال|عل)?\s*(?:ال)?اعلان|اشطب\s*(?:على|ع)?\s*(?:ال)?إعلان|تم\s*البيع|انباع|انباعت|مباع|علم\s*عليه\s*مباع|علّم\s*عليه\s*مباع|علمه\s*مباع|علّمه\s*مباع|علم\s*مباع|خله\s*مباع|خلّه\s*مباع|اشطب\s*مباع)[\s.!✅]*$/i;

export function isOwnerSoldIntent(text: string): boolean {
  const t = (text ?? "").trim();
  return t.length > 0 && t.length <= 40 && OWNER_SOLD_INTENT.test(t);
}

export const SOLD_REPLY_TEXT = "تم البيع بواسطة القناة ✅";
const pendingKey = (storeId: string, uid: string) => `psb:ownersold:${storeId}:${uid}`;
const fwdKey = (storeId: string, uid: string) => `psb:ownersold:fwd:${storeId}:${uid}`;
const PENDING_TTL = 15 * 60;

type Target = { channelId: string; messageId: number; caption?: string; isMedia?: boolean };

/** نفس أسلوب قناة Madness: الكابشن كامل مشطوب، بدون «تم البيع» داخله */
export function strikeFullCaption(htmlBody: string): string {
  let t = (htmlBody ?? "").replace(/<\/?s\b[^>]*>/gi, "").replace(/\u0336/g, "");
  t = t.replace(/^(?:\s*(?:✅\s*)?تم\s*البيع(?:\s*✅)?\s*\n)+/i, "");
  t = t.replace(/\n?(?:✅\s*)?(?:تم\s*البيع|مباع(?:ة)?|sold)(?:\s*✅)?\s*$/gim, "").trim();
  if (t.length > 1010) t = `${t.slice(0, 1009)}…`;
  return `<s>${t || "الإعلان"}</s>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function isStoreOwner(deps: AppDeps, uid: string): Promise<{ ok: boolean; store?: any }> {
  const store = await (deps.db as any).store.findUnique({
    where: { id: deps.storeId },
    select: { id: true, channelId: true, ownerTelegramId: true, ownerUsername: true },
  });
  const ok = Boolean(store) && (String(store.ownerTelegramId) === uid || isSuperAdmin(deps.config, uid));
  return { ok, store };
}

/** شطب إعلان بالقناة + رد «تم البيع بواسطة القناة» + SOLD بالقاعدة (لو موجود) */
export async function markChannelPostSold(api: any, deps: AppDeps, store: any, target: Target): Promise<{ edited: boolean; listingId?: string }> {
  const db: any = deps.db;
  const listing = await db.listing
    .findFirst({ where: { storeId: store.id, channelMessageId: target.messageId }, include: { store: true } })
    .catch(() => null);
  let struck: string;
  let isMedia = target.isMedia;
  if (target.caption && target.caption.trim()) {
    struck = strikeFullCaption(escapeHtml(target.caption));
  } else if (listing) {
    try {
      struck = strikeFullCaption(buildListingCaption(toListingView(listing)));
    } catch {
      struck = strikeFullCaption(escapeHtml(listing.description || "الإعلان"));
    }
    if (isMedia == null) isMedia = Boolean(listing.telegramVideoFileId);
  } else {
    struck = strikeFullCaption("الإعلان");
  }
  let edited = false;
  const tryEdit = async (media: boolean) => {
    if (media) await api.editMessageCaption(target.channelId, target.messageId, { caption: struck, parse_mode: "HTML" });
    else await api.editMessageText(target.channelId, target.messageId, struck, { parse_mode: "HTML" });
  };
  try {
    await tryEdit(isMedia !== false);
    edited = true;
  } catch (e: any) {
    const d = String(e?.description ?? e?.message ?? "");
    if (/not modified/i.test(d)) edited = true;
    else {
      try {
        await tryEdit(isMedia === false);
        edited = true;
      } catch (e2: any) {
        if (/not modified/i.test(String(e2?.description ?? e2?.message ?? ""))) edited = true;
        else deps.logger.warn({ err: String(e2?.description ?? e2), messageId: target.messageId }, "owner sold edit failed");
      }
    }
  }
  await api.sendMessage(target.channelId, SOLD_REPLY_TEXT, {
    reply_parameters: { message_id: target.messageId, allow_sending_without_reply: true },
  });
  if (listing && listing.status !== "SOLD") {
    await db.listing.update({ where: { id: listing.id }, data: { status: "SOLD" } });
  }
  deps.logger.info({ storeId: store.id, messageId: target.messageId, listingId: listing?.id ?? null, edited }, "owner marked channel post sold");
  return { edited, listingId: listing?.id };
}

async function forwardedTarget(ctx: BotContext, deps: AppDeps, store: any): Promise<Target | null> {
  const m: any = ctx.message;
  if (!m) return null;
  const ref = parseForwardedChannel(m);
  const originUser = m.forward_origin?.chat?.username ?? m.forward_from_chat?.username;
  if (ref?.messageId && (String(ref.channelId) === String(store.channelId) || /^madunitstore$/i.test(originUser ?? ""))) {
    const isMedia = Boolean(m.photo || m.video || m.animation || m.document);
    return { channelId: String(store.channelId), messageId: ref.messageId, caption: m.caption ?? m.text ?? "", isMedia };
  }
  if (!m.forward_origin && !m.forward_date) return null;
  // أصل مخفي / محوّل من البوت: طابق بالفيديو ثم رقم الإعلان ثم بداية الوصف
  const db: any = deps.db;
  const where: any = { storeId: store.id, channelMessageId: { not: null }, status: { in: ["PUBLISHED", "SOLD"] } };
  const uniq = m.video?.file_unique_id ?? m.photo?.at?.(-1)?.file_unique_id;
  const cap = String(m.caption ?? m.text ?? "");
  let hit: any = null;
  if (uniq) hit = await db.listing.findFirst({ where: { ...where, telegramVideoUniqueId: uniq }, orderBy: { createdAt: "desc" } }).catch(() => null);
  const code = detectInquiryCode(cap);
  if (!hit && code) hit = await db.listing.findFirst({ where: { ...where, shortCode: code.toUpperCase() } }).catch(() => null);
  if (!hit && cap.trim().length >= 15) {
    const head = cap.trim().split("\n")[0].slice(0, 25);
    hit = await db.listing.findFirst({ where: { ...where, description: { contains: head } }, orderBy: { createdAt: "desc" } }).catch(() => null);
  }
  if (!hit) return null;
  return { channelId: String(store.channelId), messageId: Number(hit.channelMessageId), caption: cap, isMedia: Boolean(m.photo || m.video) };
}

function _unusedForwardedTarget(ctx: BotContext): Target | null {
  const m: any = ctx.message;
  if (!m) return null;
  const ref = parseForwardedChannel(m);
  if (!ref || !ref.messageId) return null;
  const isMedia = Boolean(m.photo || m.video || m.animation || m.document);
  return { channelId: String(ref.channelId), messageId: ref.messageId, caption: m.caption ?? m.text ?? "", isMedia };
}

export function registerOwnerSoldHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  if (!isPrivateDirectPublishBot(deps.botUsername)) return;
  const redis: any = (deps as any).redis;

  bot.callbackQuery("osold:yes", async (ctx) => {
    await ctx.answerCallbackQuery();
    const uid = String(ctx.from?.id ?? "");
    const { ok, store } = await isStoreOwner(deps, uid);
    if (!ok || !redis) return;
    const raw = await redis.get(fwdKey(deps.storeId, uid));
    if (!raw) {
      await ctx.reply("انتهت المهلة، حوّل الإعلان مرة ثانية.");
      return;
    }
    await redis.del(fwdKey(deps.storeId, uid));
    await markChannelPostSold(ctx.api, deps, store, JSON.parse(raw));
    await ctx.reply("تم ✅");
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return next();
    const uid = String(ctx.from.id);
    const m: any = ctx.message;
    const text = String(m.text ?? m.caption ?? "").trim();
    const isFwd = Boolean(m.forward_origin || m.forward_date);
    const intent = isOwnerSoldIntent(text);
    const codeOnly = Boolean(detectInquiryCode(text)) && text.length <= 12 && !isFwd;
    if (!isFwd && !intent && !codeOnly) return next();
    const { ok, store } = await isStoreOwner(deps, uid);
    if (!ok || !store?.channelId) return next(); // non-owners: never
    const pending = redis ? Boolean(await redis.get(pendingKey(deps.storeId, uid)).catch(() => null)) : false;
    if (codeOnly && !pending) return next();

    if (intent || pending) {
      // أي ربط/إعداد معلق يتلغى
      try { await (ctx as any).conversation?.exitAll?.(); } catch { /* ignore */ }
      const sess: any = (ctx as any).session;
      if (sess) {
        sess.pendingStoreSetting = undefined;
        sess.pendingAdminAction = undefined;
        sess.pendingSellerPriceInquiryId = undefined;
      }
    }

    if (isFwd) {
      const fwd = await forwardedTarget(ctx, deps, store);
      if (!fwd) {
        if (pending || intent) {
          await ctx.reply("ما عرفت أي إعلان بالقناة هذا. أرسل رقم الإعلان مثل A009.");
          return;
        }
        return next();
      }
      if (pending || intent) {
        if (redis) await redis.del(pendingKey(deps.storeId, uid)).catch(() => undefined);
        await markChannelPostSold(ctx.api, deps, store, fwd);
        await ctx.reply("تم ✅");
        return;
      }
      if (redis) {
        await redis.set(fwdKey(deps.storeId, uid), JSON.stringify(fwd), "EX", PENDING_TTL).catch(() => undefined);
        await ctx.reply("تبي أشطبه كمباع؟", { reply_markup: new InlineKeyboard().text("اشطبه ✅", "osold:yes") });
        return;
      }
      return next();
    }

    if (intent) {
      if (redis) await redis.set(pendingKey(deps.storeId, uid), "1", "EX", PENDING_TTL).catch(() => undefined);
      await ctx.reply("حوّل لي الإعلان من القناة 👇");
      return;
    }

    const code = detectInquiryCode(text)!;
    const listing = await (deps.db as any).listing.findFirst({
      where: { storeId: store.id, shortCode: code.toUpperCase(), channelMessageId: { not: null } },
    });
    if (!listing) {
      await ctx.reply(`ما لقيت ${code} بالقناة. حوّل لي الإعلان نفسه من القناة 👇`);
      return;
    }
    if (redis) await redis.del(pendingKey(deps.storeId, uid)).catch(() => undefined);
    await markChannelPostSold(ctx.api, deps, store, { channelId: String(store.channelId), messageId: Number(listing.channelMessageId) });
    await ctx.reply("تم ✅");
  });
}
