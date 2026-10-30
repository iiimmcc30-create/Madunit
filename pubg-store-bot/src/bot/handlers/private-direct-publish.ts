import { hasRealDescription } from "../../agent/heuristic";
import { looksLikeAvailabilityAsk } from "../../agent/heuristic";
import { isForwardedMessage } from "../../domain/inquiry-detect";
import {
  hasUsableTradersCaption,
  mediaFromMessage,
  rewriteTradersCaption,
} from "../../domain/traders-ad";
import { detectTradersSold } from "../../domain/traders-sold";
import { createTelegramPublisher } from "../../infra/publisher";
import { assertSellerActive } from "../../services/seller";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";

/**
 * Bots whose PRIVATE seller ads are auto-published with the exact DMSTOR traders
 * pipeline (same strip rules / template / installments line) — no draft, no confirm.
 */
export const PRIVATE_DIRECT_PUBLISH_BOTS = ["sarhstoree_bot"] as const;

export function isPrivateDirectPublishBot(botUsername?: string | null): boolean {
  const u = (botUsername ?? "").replace(/^@/, "").toLowerCase();
  return (PRIVATE_DIRECT_PUBLISH_BOTS as readonly string[]).includes(u);
}

const BUYER_Q =
  /(موجود|انباع|تحقق|فيه\s*[؟?]|فيه\s*$|متاح\s*[؟?]|لسا|لسه|باقي\s*[؟?]|كم\s*سعر|بكم)/i;

/**
 * Pure classifier: should a private media+caption message be published as a NEW seller ad?
 * Buyer lookups (موجود/انباع/تحقق/فيه؟), forwarded ads, pasted store ads (own handle /
 * رقم الإعلان), sold/struck captions and text-only messages never publish.
 */
export function classifyPrivateSellerAd(input: {
  caption: string;
  hasMedia: boolean;
  forwarded: boolean;
  ownerUsername?: string | null;
  botUsername?: string | null;
}): { publish: boolean; reason: string } {
  const text = (input.caption ?? "").trim();
  if (!input.hasMedia) return { publish: false, reason: "no_media" };
  if (input.forwarded) return { publish: false, reason: "forwarded" };
  if (!text) return { publish: false, reason: "no_caption" };
  if (detectTradersSold(text)) return { publish: false, reason: "sold" };
  if (looksLikeAvailabilityAsk(text)) return { publish: false, reason: "buyer_question" };
  if (text.length < 60 && BUYER_Q.test(text)) return { publish: false, reason: "buyer_question" };
  if (/رقم\s*الإعلان|رقم\s*الاعلان/i.test(text)) return { publish: false, reason: "existing_store_ad" };
  for (const h of [input.ownerUsername, input.botUsername]) {
    const u = (h ?? "").replace(/^@/, "").trim();
    if (u && new RegExp(`@${u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      return { publish: false, reason: "existing_store_ad" };
    }
  }
  if (!hasRealDescription(text) || !/\d{2,}/.test(text.replace(/\(\s*4\s*,\s*6[^)]*\)/g, ""))) {
    return { publish: false, reason: "no_description_or_price" };
  }
  if (!hasUsableTradersCaption(text, input.ownerUsername ?? "", input.botUsername)) {
    return { publish: false, reason: "no_usable_caption" };
  }
  return { publish: true, reason: "seller_ad" };
}

/** Returns true when handled (published or replied); false → fall through to MAD AI agent. */
export async function tryPrivateDirectPublish(ctx: BotContext, deps: AppDeps): Promise<boolean> {
  if (!isPrivateDirectPublishBot(deps.botUsername)) return false;
  const message = ctx.message;
  if (!message || ctx.chat?.type !== "private" || !ctx.from) return false;
  const media = mediaFromMessage(message as never);
  const caption = (message.caption ?? "").trim();
  const store = await deps.db.store.findUnique({
    where: { id: deps.storeId },
    select: { id: true, channelId: true, ownerUsername: true },
  });
  if (!store?.channelId) return false;
  const verdict = classifyPrivateSellerAd({
    caption,
    hasMedia: Boolean(media),
    forwarded: isForwardedMessage(message as never),
    ownerUsername: store.ownerUsername,
    botUsername: deps.botUsername,
  });
  if (!verdict.publish || !media) {
    if (media) {
      deps.logger.info(
        { storeId: store.id, telegramId: ctx.from.id, reason: verdict.reason },
        "private direct publish skip",
      );
    }
    return false;
  }
  try {
    await assertSellerActive(deps.db, String(ctx.from.id));
  } catch {
    await ctx.reply("حسابك محظور، تواصل مع المالك.");
    return true;
  }
  if (deps.redis) {
    try {
      const fresh = await deps.redis.set(
        `pdp:file:${store.id}:${media.fileId}`,
        "1",
        "EX",
        60 * 10,
        "NX",
      );
      if (!fresh) {
        // تكرار نفس الملف خلال دقائق → تجاهل بهدوء بدون «منشور قبل»
        await ctx.reply("وصل ✅");
        return true;
      }
    } catch {
      /* redis down → publish anyway */
    }
  }
  const rewritten = rewriteTradersCaption(caption, store.ownerUsername, {
    botUsername: deps.botUsername,
  });
  try {
    const sent = await createTelegramPublisher(ctx.api).sendListing(store.channelId, {
      videoFileId: media.fileId,
      caption: rewritten,
      mediaKind: media.kind,
    });
    deps.logger.info(
      { storeId: store.id, telegramId: ctx.from.id, channelId: store.channelId, channelMessageId: sent.messageId },
      "private seller ad published",
    );
    await ctx.reply("تم نشر إعلانك في القناة ✅");
  } catch (error) {
    deps.logger.error({ err: error, storeId: store.id }, "private direct publish failed");
    await deps.redis?.del(`pdp:file:${store.id}:${media.fileId}`).catch(() => undefined);
    await ctx.reply("ما قدرت أنشر الحين، حاول بعد شوي أو تواصل مع المالك.");
  }
  return true;
}
