import { externalApp } from "./external";
import { AppError } from "../../domain/errors";
import { looksLikeOpenScrim } from "../../domain/scrim-parse";
import { parseMaxTeams, parseRoomCount, type ScrimKind } from "../../domain/scrim-types";
import { extractScrimOpenWithLlm } from "../../llm/scrim";
import {
  createScrimDraft,
  ensureScrimTemplate,
  previewOpenText,
  renderOpenCaption,
  validateOpenDraft,
} from "../../services/scrim";
import type { InsideContext, ListingConversation } from "../context";
import type { AppDeps } from "../deps";
import { scrimOpenPreviewKeyboard } from "../keyboards";

function isCancel(ctx: InsideContext): boolean {
  const text = ctx.message?.text?.trim();
  return Boolean(text && /^\/cancel(?:@\w+)?$/i.test(text));
}

function randomSecret(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

async function askText(
  conversation: ListingConversation,
  ctx: InsideContext,
  prompt: string,
): Promise<string | null> {
  await ctx.reply(prompt);
  const next = await conversation.waitUntil(
    (update) => Boolean(update.message?.text) || isCancel(update),
    { otherwise: (update) => update.reply("أرسل نص، أو /cancel.") },
  );
  if (isCancel(next)) {
    await next.reply("تم الإلغاء.");
    return null;
  }
  return next.message!.text!.trim();
}

export function makeOpenScrimConversation(deps: AppDeps) {
  return async function openScrim(
    conversation: ListingConversation,
    ctx: InsideContext,
    pending?: { text?: string },
  ) {
    const actorId = String(ctx.from?.id ?? "");
    let text = (pending?.text ?? ctx.message?.text ?? "").replace(/^\/scrim(?:@\w+)?\s*/i, "").trim();
    if (!text || text.startsWith("/") || (!looksLikeOpenScrim(text) && text.length < 8)) {
      const asked = await askText(
        conversation,
        ctx,
        "اكتب تفاصيل السكرم، مثال:\nافتح سكرم خليجي الساعة 10 الليلة 16 تيم 3 رومات سري 4455",
      );
      if (!asked) return;
      text = asked;
    }

    let extracted = await externalApp(conversation, () => extractScrimOpenWithLlm(deps.llm, text));

    if (!extracted.kind) {
      const kindText = await askText(conversation, ctx, "النوع؟ اكتب خليجي أو أوروبي.");
      if (!kindText) return;
      extracted = {
        ...extracted,
        kind: /خليج/.test(kindText) ? "GULF" : ("EUROPE" as ScrimKind),
      };
    }
    if (!extracted.timeLabel) {
      const time = await askText(conversation, ctx, "الوقت؟ مثال: الساعة 10 الليلة");
      if (!time) return;
      extracted = { ...extracted, timeLabel: time };
    }
    if (!extracted.maxTeams) {
      const maxText = await askText(conversation, ctx, "عدد الفرق؟ (من 2 إلى 25)");
      if (!maxText) return;
      extracted = { ...extracted, maxTeams: parseMaxTeams(maxText) };
    }
    if (!extracted.roomCount) {
      const rooms = await askText(conversation, ctx, "كم روم؟ (رقم من 1 إلى 8)");
      if (!rooms) return;
      extracted = { ...extracted, roomCount: parseRoomCount(rooms) };
    }
    if (!extracted.roomSecret) {
      const secret = await askText(
        conversation,
        ctx,
        "الرقم السري للروم؟ أرسل رقم/رمز، أو اكتب «توليد» نولّد واحد.",
      );
      if (!secret) return;
      extracted = {
        ...extracted,
        roomSecret: /توليد|auto/i.test(secret) ? randomSecret() : secret,
      };
    }

    try {
      const draft = validateOpenDraft(extracted);
      const created = await externalApp(conversation, () =>
        createScrimDraft(deps.db, {
          storeId: deps.storeId,
          openedByTelegramId: actorId,
          ...draft,
        }),
      );
      const template = await externalApp(conversation, () => ensureScrimTemplate(deps.db, deps.storeId));
      const caption = renderOpenCaption(template, created);
      await ctx.reply(previewOpenText(template, { ...created, rules: created.rules }), {
        reply_markup: scrimOpenPreviewKeyboard(created.id),
      });
      if (template.openPhotoFileId) {
        await ctx.reply("صورة الإعلان المحفوظة:");
        await ctx.replyWithPhoto(template.openPhotoFileId, { caption: caption.slice(0, 1000) });
      }
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما قدرت أجهّز السكرم. حاول صياغة أوضح.");
    }
  };
}
