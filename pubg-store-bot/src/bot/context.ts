import type { Context, SessionFlavor } from "grammy";
import type { Conversation, ConversationFlavor } from "@grammyjs/conversations";

export interface PendingVideo {
  fileId: string;
  uniqueId: string;
}

export interface ListingStart {
  storeId?: string;
  fileId?: string;
  uniqueId?: string;
}

export type StoreSettingField = "fee" | "username" | "title" | "instructions" | "glossary";

export type ScrimSettingField =
  | "photo"
  | "europe"
  | "gulf"
  | "rules"
  | "commit"
  | "phrase"
  | "lock"
  | "roster"
  | "room"
  | "result"
  | "thanks"
  | "scoring"
  | "auto"
  | "mod"
  | "group"
  | "drops"
  | "pass"
  | "dropslead"
  | "startslot"
  | "linefmt"
  | "details"
  | "maps";

export type AdminPendingAction =
  | { kind: "add_token" }
  | { kind: "extend"; storeId: string; alsoEnable?: boolean }
  | { kind: "scrim_token"; storeId: string };

export interface SessionData {
  pendingVideo?: PendingVideo;
  pendingSellerPriceInquiryId?: string;
  pendingUnbindConfirm?: boolean;
  pendingReceiptListingId?: string;
  pendingStoreSetting?: { storeId: string; field: StoreSettingField };
  pendingSubscriptionReceipt?: boolean;
  pendingAdminAction?: AdminPendingAction;
  pendingScrimSetting?: { field: ScrimSettingField };
  pendingScrimRosterEdit?: string;
  pendingScrimAddTeam?: string;
  pendingScrimRemoveTeam?: string;
  pendingScrimResultEdit?: string;
  homeStoreId?: string;
}

export type SessionContext = Context & SessionFlavor<SessionData>;
export type BotContext = ConversationFlavor<SessionContext>;
export type InsideContext = SessionContext;
export type ListingConversation = Conversation<BotContext, InsideContext>;
