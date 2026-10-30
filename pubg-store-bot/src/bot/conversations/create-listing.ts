import { externalApp } from "./external";
import { AppError } from "../../domain/errors";
import type { ExtractedFields } from "../../domain/extract";
import { missingListingFields } from "../../domain/extract";
import { parsePrice } from "../../domain/price";
import type { ListingAnalysis } from "../../llm";
import { buildListingCaption } from "../../services/listing";
import { assertSellerActive, type SellerView } from "../../services/seller";
import { getStoreById, type StoreView } from "../../services/store";
import type { InsideContext, ListingConversation, ListingStart } from "../context";
import type { AppDeps } from "../deps";
import { editKeyboard, previewKeyboard } from "../keyboards";
import { texts } from "../texts";

function isCancel(ctx: InsideContext): boolean {
  const text = ctx.message?.text?.trim();
  return Boolean(text && /^\/cancel(?:@\w+)?$/i.test(text));
}

export function makeCreateListingConversation(deps: AppDeps) {
  return async function createListing(
    conversation: ListingConversation,
    ctx: InsideContext,
    pending?: ListingStart,
  ) {
    const from = ctx.from;
    if (!from) {
      await ctx.reply("ما قدرت أتعرف عليك. أرسل /start من الخاص.");
      return;
    }
    const sellerTelegramId = String(from.id);

    let seller: SellerView;
    try {
      seller = await externalApp(conversation, () =>
        assertSellerActive(deps.db, sellerTelegramId),
      );
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : texts.banned);
      return;
    }

    let store: StoreView;
    try {
      store = await externalApp(conversation, () => getStoreById(deps.db, deps.storeId));
    } catch {
      await ctx.reply(texts.noStores);
      return;
    }
    const selectedStore = store;
    await ctx.reply(texts.listingForStore(selectedStore.title));

    let videoFileId = pending?.fileId;
    let videoUniqueId = pending?.uniqueId ?? null;

    if (!videoFileId) {
      await ctx.reply(texts.askVideo);
      const videoCtx = await conversation.waitUntil(
        (update) => Boolean(update.message?.video) || isCancel(update),
        { otherwise: (update) => update.reply(texts.needVideo) },
      );
      if (isCancel(videoCtx)) {
        await videoCtx.reply(texts.cancelled);
        return;
      }
      videoFileId = videoCtx.message!.video!.file_id;
      videoUniqueId = videoCtx.message!.video!.file_unique_id;
    }

    await ctx.reply(texts.askFreeListing);
    const descCtx = await conversation.waitUntil(
      (update) => Boolean(update.message?.text) || isCancel(update),
      { otherwise: (update) => update.reply(texts.needDescription) },
    );
    if (isCancel(descCtx)) {
      await descCtx.reply(texts.cancelled);
      return;
    }
    let rawText = descCtx.message!.text!.trim();
    while (rawText.startsWith("/") || rawText.length < 3) {
      await ctx.reply("اكتب وصف أوضح للحساب (مو أمر).");
      const retry = await conversation.waitUntil(
        (update) => Boolean(update.message?.text) || isCancel(update),
        { otherwise: (update) => update.reply(texts.needDescription) },
      );
      if (isCancel(retry)) {
        await retry.reply(texts.cancelled);
        return;
      }
      rawText = retry.message!.text!.trim();
    }

    let analysis: ListingAnalysis = await externalApp(conversation, () =>
      deps.llm.analyzeListing(rawText),
    );
    let description = analysis.description;
    let price = analysis.price;
    let binding = analysis.fields.binding ?? "";
    let extracted: ExtractedFields = analysis.fields;
    if (analysis.strippedContact) {
      await ctx.reply(texts.contactStripped);
    }

    const missing = missingListingFields({ description, price, binding });
    for (const field of missing) {
      if (field === "description") {
        await ctx.reply(texts.askDescription);
        const d = await conversation.waitUntil(
          (update) => Boolean(update.message?.text) || isCancel(update),
          { otherwise: (update) => update.reply(texts.needDescription) },
        );
        if (isCancel(d)) {
          await d.reply(texts.cancelled);
          return;
        }
        analysis = await externalApp(conversation, () =>
          deps.llm.analyzeListing(d.message!.text!.trim()),
        );
        description = analysis.description;
        extracted = analysis.fields;
        price = price ?? analysis.price;
        binding = binding || analysis.fields.binding || "";
      }
      if (field === "price") {
        await ctx.reply(texts.askPrice);
        while (price === null) {
          const priceCtx = await conversation.waitUntil(
            (update) => Boolean(update.message?.text) || isCancel(update),
            { otherwise: (update) => update.reply(texts.needPrice) },
          );
          if (isCancel(priceCtx)) {
            await priceCtx.reply(texts.cancelled);
            return;
          }
          price = parsePrice(priceCtx.message!.text!);
          if (price === null) await ctx.reply(texts.needPrice);
        }
      }
      if (field === "binding") {
        await ctx.reply(texts.askBinding);
        const bindCtx = await conversation.waitUntil(
          (update) => Boolean(update.message?.text) || isCancel(update),
          { otherwise: (update) => update.reply(texts.needBinding) },
        );
        if (isCancel(bindCtx)) {
          await bindCtx.reply(texts.cancelled);
          return;
        }
        binding = bindCtx.message!.text!.trim();
      }
    }

    let listingId: string | undefined;

    async function persistDraft() {
      const listing = await externalApp(conversation, () =>
        deps.listings.saveDraft({
          id: listingId,
          storeId: selectedStore.id,
          sellerId: seller.id,
          sellerTelegramId,
          videoFileId: videoFileId!,
          videoUniqueId,
          description,
          price: price!,
          binding,
          extractedFields: extracted,
        }),
      );
      listingId = listing.id;
      return listing;
    }

    await persistDraft();

    while (true) {
      const listing = await persistDraft();
      const caption = buildListingCaption(listing);

      await ctx.replyWithVideo(videoFileId, {
        caption,
        parse_mode: "HTML",
        reply_markup: previewKeyboard(),
      });
      await ctx.reply(texts.previewHint);

      const action = await conversation.waitUntil(
        (update) => Boolean(update.callbackQuery?.data?.startsWith("preview:")) || isCancel(update),
        { otherwise: (update) => update.reply(texts.useButtons) },
      );

      if (isCancel(action)) {
        await externalApp(conversation, () => deps.listings.cancel(listingId!, sellerTelegramId));
        await action.reply(texts.cancelled);
        return;
      }

      await action.answerCallbackQuery();
      const data = action.callbackQuery!.data;

      if (data === "preview:publish") {
        try {
          const published = await externalApp(conversation, () =>
            deps.listings.requestPublish(listingId!, sellerTelegramId),
          );
          if (published.id !== listingId && published.status === "PUBLISHED") {
            await ctx.reply(texts.duplicateUpdated(published.shortCode, String(published.price)));
            return;
          }
          if (published.status === "PENDING_PAYMENT") {
            ctx.session.pendingReceiptListingId = listingId;
            await ctx.reply(
              texts.askReceipt(String(published.listingFee), selectedStore.paymentInstructions),
            );
            const photoCtx = await conversation.waitUntil(
              (update) => Boolean(update.message?.photo?.length) || isCancel(update),
              { otherwise: (update) => update.reply(texts.needReceipt) },
            );
            if (isCancel(photoCtx)) {
              ctx.session.pendingReceiptListingId = undefined;
              await externalApp(conversation, () => deps.listings.cancel(listingId!, sellerTelegramId));
              await photoCtx.reply(texts.cancelled);
              return;
            }
            const photo = photoCtx.message!.photo!.at(-1);
            await externalApp(conversation, () =>
              deps.payments.submitReceipt({
                listingId: listingId!,
                sellerTelegramId,
                photoFileId: photo!.file_id,
              }),
            );
            ctx.session.pendingReceiptListingId = undefined;
            return;
          }
          await ctx.reply(texts.published(published.shortCode));
        } catch (error) {
          const message =
            error instanceof AppError ? error.userMessage : "صار خطأ أثناء النشر، حاول مرة ثانية.";
          deps.logger.error({ err: error }, "publish failed");
          await ctx.reply(message);
        }
        return;
      }

      if (data === "preview:cancel") {
        await externalApp(conversation, () => deps.listings.cancel(listingId!, sellerTelegramId));
        await ctx.reply(texts.cancelled);
        return;
      }

      if (data !== "preview:edit") continue;

      await ctx.reply(texts.editWhat, { reply_markup: editKeyboard() });
      const editAction = await conversation.waitUntil(
        (update) => Boolean(update.callbackQuery?.data?.startsWith("edit:")) || isCancel(update),
        { otherwise: (update) => update.reply("اختر من الأزرار وش تبي تعدل.") },
      );
      if (isCancel(editAction)) {
        await externalApp(conversation, () => deps.listings.cancel(listingId!, sellerTelegramId));
        await editAction.reply(texts.cancelled);
        return;
      }
      await editAction.answerCallbackQuery();
      const editData = editAction.callbackQuery!.data;

      if (editData === "edit:back") continue;

      if (editData === "edit:video") {
        await ctx.reply(texts.askVideo);
        const v = await conversation.waitUntil(
          (update) => Boolean(update.message?.video) || isCancel(update),
          { otherwise: (update) => update.reply(texts.needVideo) },
        );
        if (isCancel(v)) continue;
        videoFileId = v.message!.video!.file_id;
        videoUniqueId = v.message!.video!.file_unique_id;
      }

      if (editData === "edit:desc") {
        await ctx.reply(texts.askFreeListing);
        const d = await conversation.waitUntil(
          (update) => Boolean(update.message?.text) || isCancel(update),
          { otherwise: (update) => update.reply(texts.needDescription) },
        );
        if (isCancel(d)) continue;
        analysis = await externalApp(conversation, () =>
          deps.llm.analyzeListing(d.message!.text!.trim()),
        );
        description = analysis.description;
        extracted = analysis.fields;
        if (analysis.price) price = analysis.price;
        if (analysis.fields.binding) binding = analysis.fields.binding;
        if (analysis.strippedContact) await ctx.reply(texts.contactStripped);
      }

      if (editData === "edit:price") {
        await ctx.reply(texts.askPrice);
        const p = await conversation.waitUntil(
          (update) => Boolean(update.message?.text) || isCancel(update),
          { otherwise: (update) => update.reply(texts.needPrice) },
        );
        if (isCancel(p)) continue;
        const parsed = parsePrice(p.message!.text!);
        if (!parsed) {
          await ctx.reply(texts.needPrice);
          continue;
        }
        price = parsed;
      }

      if (editData === "edit:bind") {
        await ctx.reply(texts.askBinding);
        const b = await conversation.waitUntil(
          (update) => Boolean(update.message?.text) || isCancel(update),
          { otherwise: (update) => update.reply(texts.needBinding) },
        );
        if (isCancel(b)) continue;
        binding = b.message!.text!.trim();
        extracted = { ...extracted, binding };
      }
    }
  };
}
