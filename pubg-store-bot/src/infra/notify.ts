import { InlineKeyboard, type Api } from "grammy";
import { texts } from "../bot/texts";
import { formatPrice } from "../domain/price";

export interface PartyInfo {
  telegramId: string;
  username?: string;
  firstName?: string;
}

export interface InquiryNotifier {
  askSeller(sellerId: string, inquiryId: string, shortCode: string): Promise<boolean>;
  remindSeller(sellerId: string, inquiryId: string, shortCode: string): Promise<void>;
  tellBuyerChecking(buyerId: string, shortCode: string): Promise<void>;
  tellBuyerAvailable(
    buyerId: string,
    shortCode: string,
    price: number,
    ownerUsername: string,
  ): Promise<void>;
  tellBuyerSold(buyerId: string, shortCode: string, ownerUsername: string): Promise<void>;
  tellBuyerTimeout(buyerId: string, shortCode: string, ownerUsername: string): Promise<void>;
  tellBuyerAlreadyWaiting(buyerId: string, shortCode: string): Promise<void>;
  tellBuyerOwnListing(buyerId: string): Promise<void>;
  tellBuyerNotPublished(buyerId: string, shortCode: string, reason: string): Promise<void>;
  tellBuyerListingMatch(
    buyerId: string,
    shortCode: string,
    ownerUsername: string,
    summary: string,
  ): Promise<void>;
  tellOwnerAvailable(input: {
    ownerId: string;
    shortCode: string;
    price: number;
    buyer: PartyInfo;
    seller: PartyInfo;
    description: string;
  }): Promise<void>;
  tellOwnerTimeout(input: {
    ownerId: string;
    shortCode: string;
    buyer: PartyInfo;
    seller: PartyInfo;
  }): Promise<void>;
  tellOwnerSellerUnreachable(input: {
    ownerId: string;
    shortCode: string;
    buyer: PartyInfo;
    seller: PartyInfo;
  }): Promise<void>;
  tellSellerPricePrompt(sellerId: string): Promise<void>;
  tellSellerAck(sellerId: string, text: string): Promise<void>;
  resolveParty(telegramId: string): Promise<PartyInfo>;
}

function ownerContactKeyboard(ownerUsername: string) {
  return new InlineKeyboard().url(
    "تواصل مع المالك",
    `https://t.me/${ownerUsername.replace(/^@/, "")}`,
  );
}

export function sellerReplyKeyboard(inquiryId: string) {
  return new InlineKeyboard()
    .text("موجود", `iq:ok:${inquiryId}`)
    .text("انباع", `iq:no:${inquiryId}`);
}

export function formatParty(party: PartyInfo): string {
  const user = party.username ? `@${party.username.replace(/^@/, "")}` : "بدون يوزر";
  const name = party.firstName ? ` — ${party.firstName}` : "";
  return `${user}${name}\nالآيدي: <code>${party.telegramId}</code>`;
}

export function createTelegramNotifier(api: Api): InquiryNotifier {
  return {
    async askSeller(sellerId, inquiryId, shortCode) {
      try {
        await api.sendMessage(sellerId, texts.sellerInquiryAsk(shortCode), {
          reply_markup: sellerReplyKeyboard(inquiryId),
        });
        return true;
      } catch {
        return false;
      }
    },
    async remindSeller(sellerId, inquiryId, shortCode) {
      try {
        await api.sendMessage(sellerId, texts.sellerInquiryReminder(shortCode), {
          reply_markup: sellerReplyKeyboard(inquiryId),
        });
      } catch {
        // البائع قد يكون مغلق الخاص
      }
    },
    async tellBuyerChecking(buyerId, shortCode) {
      await api.sendMessage(buyerId, texts.buyerChecking(shortCode));
    },
    async tellBuyerAvailable(buyerId, shortCode, price, ownerUsername) {
      await api.sendMessage(buyerId, texts.buyerAvailable(shortCode, formatPrice(price)), {
        reply_markup: ownerContactKeyboard(ownerUsername),
      });
    },
    async tellBuyerSold(buyerId, shortCode, ownerUsername) {
      await api.sendMessage(buyerId, texts.buyerSold(shortCode), {
        reply_markup: ownerContactKeyboard(ownerUsername),
      });
    },
    async tellBuyerTimeout(buyerId, shortCode, ownerUsername) {
      await api.sendMessage(buyerId, texts.buyerTimeout(shortCode), {
        reply_markup: ownerContactKeyboard(ownerUsername),
      });
    },
    async tellBuyerAlreadyWaiting(buyerId, shortCode) {
      await api.sendMessage(buyerId, texts.buyerAlreadyWaiting(shortCode));
    },
    async tellBuyerOwnListing(buyerId) {
      await api.sendMessage(buyerId, texts.buyerOwnListing);
    },
    async tellBuyerNotPublished(buyerId, shortCode, reason) {
      await api.sendMessage(buyerId, texts.buyerNotPublished(shortCode, reason));
    },
    async tellBuyerListingMatch(buyerId, shortCode, ownerUsername, summary) {
      await api.sendMessage(buyerId, texts.buyerListingMatch(shortCode, summary), {
        reply_markup: ownerContactKeyboard(ownerUsername),
      });
    },
    async tellOwnerAvailable(input) {
      await api.sendMessage(
        input.ownerId,
        texts.ownerInquiryAvailable(
          input.shortCode,
          formatPrice(input.price),
          formatParty(input.buyer),
          formatParty(input.seller),
          input.description,
        ),
        { parse_mode: "HTML" },
      );
    },
    async tellOwnerTimeout(input) {
      await api.sendMessage(
        input.ownerId,
        texts.ownerInquiryTimeout(
          input.shortCode,
          formatParty(input.buyer),
          formatParty(input.seller),
        ),
        { parse_mode: "HTML" },
      );
    },
    async tellOwnerSellerUnreachable(input) {
      await api.sendMessage(
        input.ownerId,
        texts.ownerSellerUnreachable(
          input.shortCode,
          formatParty(input.buyer),
          formatParty(input.seller),
        ),
        { parse_mode: "HTML" },
      );
    },
    async tellSellerPricePrompt(sellerId) {
      await api.sendMessage(sellerId, texts.sellerAskLastPrice);
    },
    async tellSellerAck(sellerId, text) {
      await api.sendMessage(sellerId, text);
    },
    async resolveParty(telegramId) {
      try {
        const chat = await api.getChat(telegramId);
        const username = "username" in chat ? chat.username : undefined;
        const firstName = "first_name" in chat ? chat.first_name : undefined;
        return { telegramId, username, firstName };
      } catch {
        return { telegramId };
      }
    },
  };
}
