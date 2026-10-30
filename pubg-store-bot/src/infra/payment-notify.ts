import { InlineKeyboard, type Api } from "grammy";
import { texts } from "../bot/texts";
import { formatPrice } from "../domain/price";
import type { PaymentNotifier } from "../services/payment";

function reviewKeyboard(paymentId: string) {
  return new InlineKeyboard()
    .text("تأكيد وانشر", `pay:ok:${paymentId}`)
    .text("رفض", `pay:no:${paymentId}`);
}

export function createPaymentNotifier(api: Api): PaymentNotifier {
  return {
    async sendReceiptToOwner(input) {
      await api.sendPhoto(input.ownerId, input.photoFileId, {
        caption: texts.receiptOwnerCaption(
          input.shortCode,
          formatPrice(input.amount),
          input.sellerTelegramId,
        ),
        parse_mode: "HTML",
        reply_markup: reviewKeyboard(input.paymentId),
      });
    },
    async tellSellerReceiptReceived(sellerId, shortCode) {
      await api.sendMessage(sellerId, texts.receiptSent(shortCode));
    },
    async tellSellerPublished(sellerId, shortCode) {
      await api.sendMessage(sellerId, texts.published(shortCode));
    },
    async tellSellerRejected(sellerId, shortCode) {
      await api.sendMessage(sellerId, texts.sellerPaymentRejected(shortCode));
    },
  };
}
