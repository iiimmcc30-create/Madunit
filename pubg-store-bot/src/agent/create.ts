import { hasRealDescription, realDescriptionOrUndefined } from "./heuristic";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Logger } from "../logger";
import type { LlmProvider } from "../llm/types";
import {
  loadGlobalGlossary,
  mergeGlossary,
  parseGlossary,
  parseGlossaryText,
  type GlossaryEntry,
} from "../domain/glossary";
import { AppError } from "../domain/errors";
import { formatSubscription } from "../domain/subscription";
import { logUnmatchedUtterance } from "../services/unmatched";
import { saveBuyerRequest } from "../services/buyer-request";
import { assertSellerActive, bindSellerToStore } from "../services/seller";
import type { InquiryService } from "../services/inquiry";
import type { ListingService, ListingView } from "../services/listing";
import type { PaymentService } from "../services/payment";
import { submitSubscriptionReceipt } from "../services/subscription";
import { listAdminStores, updateStoreSettings } from "../services/store";
import { formatStoreStats, getStoreStats } from "../services/stats";
import { texts } from "../bot/texts";
import { createChatMemory, type ChatMemory } from "./memory";
import { toPublicListing, type PublicListing } from "./public-listing";
import { rankListings, type ListingSearchFilters, type SearchableListing } from "./search";
import { runAgentSession } from "./runner";
import type { AgentListingDraft, AgentMedia, AgentToolRuntime, PendingAgentConfirm } from "./tools";
import { isStoreAdmin, listingFlowTools, resolveActorRole, type AgentRole } from "./roles";
import { looksLikeAvailabilityAsk, looksLikeExistingStoreAd, looksLikeOwnerAdmin, looksLikeSellIntent } from "./heuristic";
import type Redis from "ioredis";

export interface StoreAgentInput {
  telegramId: string;
  text: string;
  storeId?: string | null;
  media?: AgentMedia;
  confirmed?: PendingAgentConfirm | null;
  /** Set when user forwarded a channel ad — pins that listing for this turn + memory. */
  focusShortCode?: string | null;
}

export interface StoreAgentReply {
  text: string;
  pendingConfirm?: PendingAgentConfirm;
}

export function listingViewToSearchable(listing: ListingView): SearchableListing {
  return {
    shortCode: listing.shortCode,
    storeId: listing.storeId,
    price: listing.price,
    description: listing.description,
    ownerUsername: listing.ownerUsername,
    extractedFields: listing.extractedFields,
  };
}

export function listingViewToPublic(listing: ListingView): PublicListing {
  return toPublicListing(listingViewToSearchable(listing));
}

export function createStoreAgent(deps: {
  db: PrismaClient;
  redis: Redis;
  llm: LlmProvider;
  listings: ListingService;
  inquiries: InquiryService;
  payments: PaymentService;
  logger: Logger;
  defaultChannelId: string;
  superAdminTelegramId: string;
  envOwnerId: string;
  subscriptionPriceSar: number;
  subscriptionDays: number;
}) {
  const memory = createChatMemory(deps.redis);

  return {
    memory,
    async reply(input: StoreAgentInput): Promise<StoreAgentReply> {
      const store = await resolveStore(deps.db, input.storeId, input.telegramId, deps.defaultChannelId);
      if (!store) {
        return { text: "افتح رابط المتجر أول (/start) عشان أعرف أي قناة." };
      }
      const glossary = mergeGlossary(loadGlobalGlossary(), store.customGlossary);
      const history = await memory.history(store.id, input.telegramId);
      if (input.focusShortCode) {
        await memory.setFocus(store.id, input.telegramId, input.focusShortCode);
      }
      const focusShortCode =
        input.focusShortCode ?? (await memory.getFocus(store.id, input.telegramId));
      let draft = await memory.getDraft(store.id, input.telegramId);
      const lastSearchCodes = await memory.getLastSearch(store.id, input.telegramId);
      const longTerm = await deps.db.userMemory.findUnique({
        where: { storeId_telegramId: { storeId: store.id, telegramId: input.telegramId } },
      });
      // اربط كبائع فقط بنية بيع صريحة — ميديا/تحقق توفر ما تحوّل المشتري لبائع
      const availAsk = looksLikeAvailabilityAsk(input.text);
      const pasteLooksLikeStoreAd = looksLikeExistingStoreAd(input.text);
      const wantsList = looksLikeSellIntent(input.text) && !availAsk;
      if (wantsList) {
        try {
          await bindSellerToStore(deps.db, input.telegramId, store.id);
        } catch (error) {
          deps.logger.warn({ err: error, telegramId: input.telegramId, storeId: store.id }, "auto-bind seller failed");
        }
      }
      const role = await resolveRole(deps.db, store, input.telegramId, deps.superAdminTelegramId, deps.envOwnerId);
      const sellerish = role === "seller" || isStoreAdmin(role);
      // مشتري + لصق إعلان / أي سؤال توفر → lookup. بائع معروف يلصق إعلان → نشر.
      const buyerLookup = availAsk || (pasteLooksLikeStoreAd && !sellerish);
      deps.logger.info(
        {
          telegramId: input.telegramId,
          role,
          storeId: store.id,
          storeOwnerTelegramId: store.ownerTelegramId || null,
          superAdminTelegramId: deps.superAdminTelegramId,
          envOwnerTelegramId: deps.envOwnerId,
          matchStoreOwner: Boolean(store.ownerTelegramId) && store.ownerTelegramId === input.telegramId,
          matchSuperAdmin: input.telegramId === deps.superAdminTelegramId,
        },
        "actor role resolved",
      );
      const [publishedListings, waitingInquiries] = await Promise.all([
        deps.db.listing.count({ where: { storeId: store.id, status: "PUBLISHED" } }),
        deps.db.inquiry.count({ where: { status: "WAITING_SELLER", listing: { storeId: store.id } } }),
      ]);
      let media = input.media ?? {};
      // تحقق التوفر / لصق إعلان: لا تعيد ميديا معلّقة ولا تترك مسودة بيع بالغلط
      if (buyerLookup || looksLikeAvailabilityAsk(input.text)) {
        try {
          await memory.takePendingMedia(store.id, input.telegramId);
        } catch {
          /* ignore */
        }
        media = {};
        if (draft) {
          await memory.clearDraft(store.id, input.telegramId);
          draft = null;
        }
      } else if (media.photoFileId || media.videoFileId) {
        // ميديا هالدور تبقى؛ علّقها فقط لمسار البيع الصريح أو المسودة
        if (looksLikeSellIntent(input.text) || draft) {
          await memory.setPendingMedia(store.id, input.telegramId, media);
        }
      } else if (looksLikeSellIntent(input.text) || draft) {
        const pending = await memory.takePendingMedia(store.id, input.telegramId);
        if (pending) {
          media = { ...pending, ...media };
        }
      } else {
        // مشتري عادي: ارمِ الميديا المعلّقة عشان «موجود؟» بعد Forward ما تفتح مسودة
        try {
          await memory.takePendingMedia(store.id, input.telegramId);
        } catch {
          /* ignore */
        }
      }
      const runtime = makeRuntime({
        db: deps.db,
        listings: deps.listings,
        inquiries: deps.inquiries,
        payments: deps.payments,
        memory,
        telegramId: input.telegramId,
        store,
        glossary,
        focusShortCode,
        ownerUsername: store.ownerUsername,
        role,
        media,
        draft,
        lastSearchCodes,
        longTermSummary: longTerm?.summary ?? "",
        envOwnerId: deps.envOwnerId,
        subscriptionPriceSar: deps.subscriptionPriceSar,
        subscriptionDays: deps.subscriptionDays,
      });

      await memory.append(store.id, input.telegramId, { role: "user", text: input.text });
      const result = await runAgentSession({
        llm: deps.llm,
        storeTitle: store.title,
        ownerUsername: store.ownerUsername,
        glossary,
        history,
        focusShortCode,
        userText: input.text,
        runtime,
        role,
        media,
        longTermSummary: longTerm?.summary ?? "",
        confirmed: input.confirmed,
        snapshot: {
          title: store.title,
          channelId: store.channelId,
          publishedListings,
          waitingInquiries,
        },
      });
      await memory.append(store.id, input.telegramId, { role: "assistant", text: result.text });
      if (
        isStoreAdmin(role) &&
        (looksLikeOwnerAdmin(input.text) || !result.usedTools.some((tool) => listingFlowTools().has(tool)))
      ) {
        if (looksLikeOwnerAdmin(input.text) && draft) {
          await memory.clearDraft(store.id, input.telegramId);
        }
      }
      if (result.pendingConfirm) {
        await memory.setConfirm(store.id, input.telegramId, result.pendingConfirm);
      }
      await refreshUserMemory(deps, store.id, input.telegramId, history, input.text, focusShortCode);
      if (result.unmatched) {
        try {
          await logUnmatchedUtterance(deps.db, {
            telegramId: input.telegramId,
            storeId: store.id,
            text: input.text,
            reason: "unclear",
          });
        } catch (error) {
          deps.logger.warn({ err: error }, "failed to log unmatched utterance");
        }
      }
      return { text: result.text, pendingConfirm: result.pendingConfirm };
    },
  };
}

export type StoreAgent = ReturnType<typeof createStoreAgent>;

type StoreRow = {
  id: string;
  title: string;
  channelId: string | null;
  ownerUsername: string;
  ownerTelegramId: string;
  customGlossary: unknown;
  listingFee: { toNumber(): number };
  paymentInstructions: string | null;
  subscriptionStatus: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED";
  subscriptionExpiresAt: Date | null;
  plan: "FREE" | "MONTHLY";
  botEnabled: boolean;
};

async function resolveStore(
  db: PrismaClient,
  storeId: string | null | undefined,
  telegramId: string,
  defaultChannelId: string,
) {
  if (storeId) {
    const row = await db.store.findUnique({ where: { id: storeId } });
    if (row) return viewStore(row);
  }
  const seller = await db.seller.findUnique({ where: { telegramId } });
  if (seller?.homeStoreId) {
    const home = await db.store.findUnique({ where: { id: seller.homeStoreId } });
    if (home) return viewStore(home);
  }
  const fallback = await db.store.findUnique({ where: { channelId: defaultChannelId } });
  return fallback ? viewStore(fallback) : null;
}

function viewStore(row: StoreRow) {
  return {
    id: row.id,
    title: row.title || row.ownerUsername,
    channelId: row.channelId,
    ownerUsername: row.ownerUsername,
    ownerTelegramId: row.ownerTelegramId,
    customGlossary: parseGlossary(row.customGlossary),
    listingFee: row.listingFee.toNumber(),
    paymentInstructions: row.paymentInstructions ?? "",
    subscriptionLabel: formatSubscription({
      subscriptionStatus: row.subscriptionStatus,
      subscriptionExpiresAt: row.subscriptionExpiresAt,
      plan: row.plan,
      botEnabled: row.botEnabled,
    }),
  };
}

async function resolveRole(
  db: PrismaClient,
  store: { id: string; ownerTelegramId: string },
  telegramId: string,
  superAdminId: string,
  envOwnerId: string,
): Promise<AgentRole> {
  const seller = await db.seller.findUnique({ where: { telegramId } });
  let isSellerOnStore = false;
  if (seller) {
    if (seller.homeStoreId === store.id) isSellerOnStore = true;
    else {
      const listed = await db.listing.count({ where: { storeId: store.id, sellerId: seller.id } });
      isSellerOnStore = listed > 0;
    }
  }
  return resolveActorRole({
    telegramId,
    storeOwnerTelegramId: store.ownerTelegramId,
    superAdminTelegramId: superAdminId,
    envOwnerTelegramId: envOwnerId,
    isSellerOnStore,
  });
}

function fail(error: unknown): { ok: false; message: string } {
  return {
    ok: false,
    message: error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.",
  };
}

function makeRuntime(input: {
  db: PrismaClient;
  listings: ListingService;
  inquiries: InquiryService;
  payments: PaymentService;
  memory: ChatMemory;
  telegramId: string;
  store: ReturnType<typeof viewStore>;
  glossary: GlossaryEntry[];
  focusShortCode: string | null;
  ownerUsername: string;
  role: AgentRole;
  media: AgentMedia;
  draft: AgentListingDraft | null;
  lastSearchCodes: string[];
  longTermSummary: string;
  envOwnerId: string;
  subscriptionPriceSar: number;
  subscriptionDays: number;
}): AgentToolRuntime {
  let focus = input.focusShortCode;
  let draft = input.draft;
  let lastSearchCodes = input.lastSearchCodes;
  const storeId = input.store.id;

  async function publishCurrent(): Promise<any> {
    const current = draft;
    if (!current?.videoFileId) {
      return { ok: false, message: "أبي فيديو أو صورة للحساب قبل النشر." };
    }
    if (!current.price) {
      return { ok: false, message: "حدد السعر بالريال قبل النشر." };
    }
    if (!hasRealDescription(current.description)) {
      return {
        ok: false,
        message: "الفيديو محفوظ ✅ بس ناقص وصف الحساب. أرسل الوصف (اللفل، السكنات، المثاليات، الربط) مع السعر برسالة وحدة وأكمل لك الإعلان.",
      };
    }
    try {
      const seller = await assertSellerActive(input.db, input.telegramId);
      const saved = await input.listings.saveDraft({
        id: current.listingId,
        storeId,
        sellerId: seller.id,
        sellerTelegramId: input.telegramId,
        videoFileId: current.videoFileId,
        videoUniqueId: current.videoUniqueId,
        description: current.description!,
        price: current.price,
        binding: current.binding || "",
      });
      await persistDraft({ ...current, listingId: saved.id });
      const published = await input.listings.requestPublish(saved.id, input.telegramId);
      await input.memory.clearDraft(storeId, input.telegramId);
      draft = null;
      return { ok: true, message: texts.published(published.shortCode), shortCode: published.shortCode };
    } catch (error) {
      return fail(error);
    }
  }

  async function persistDraft(next: AgentListingDraft) {
    draft = next;
    await input.memory.setDraft(storeId, input.telegramId, next);
  }

  return {
    ownerUsername: input.ownerUsername,
    role: input.role,
    confirmed: false,
    media: input.media,
    get draft() {
      return draft;
    },
    get lastSearchCodes() {
      return lastSearchCodes;
    },
    longTermSummary: input.longTermSummary,
    get focusShortCode() {
      return focus;
    },
    async setFocus(shortCode: string) {
      focus = shortCode;
      await input.memory.setFocus(storeId, input.telegramId, shortCode);
    },
    async setLastSearchCodes(codes: string[]) {
      lastSearchCodes = codes;
      await input.memory.setLastSearch(storeId, input.telegramId, codes);
    },
    async searchListings(filters: ListingSearchFilters) {
      const rows = await input.listings.listPublishedForStore(storeId);
      return rankListings(rows, { ...filters, limit: 3 }, input.glossary);
    },
    async getListing(shortCode: string) {
      try {
        const listing = await input.listings.getByShortCode(shortCode, storeId);
        if (listing.status !== "PUBLISHED") return null;
        if (listing.storeId !== storeId) return null;
        return listingViewToPublic(listing);
      } catch {
        return null;
      }
    },
    async createInquiry(shortCode: string) {
      return input.inquiries.openFromBuyer({
        buyerTelegramId: input.telegramId,
        shortCode,
        notifyBuyer: false,
        storeId,
      });
    },
    async saveBuyerRequest(payload) {
      await saveBuyerRequest(input.db, {
        storeId,
        buyerTelegramId: input.telegramId,
        budgetMax: payload.budgetMax,
        skins: payload.skins,
        binding: payload.binding,
        notes: payload.notes,
      });
      return { ok: true, message: texts.buyerRequestSaved };
    },
    async startListing(payload) {
      const pending = await input.memory.takePendingMedia(storeId, input.telegramId);
      const media = {
        videoFileId: input.media.videoFileId || pending?.videoFileId,
        videoUniqueId: input.media.videoUniqueId || pending?.videoUniqueId,
        photoFileId: input.media.photoFileId || pending?.photoFileId,
      };
      const videoFileId = media.videoFileId || draft?.videoFileId;
      const photoFileId = media.photoFileId || draft?.photoFileId;
      const mediaKind: AgentListingDraft["mediaKind"] = videoFileId
        ? "video"
        : photoFileId
          ? "photo"
          : draft?.mediaKind;
      // نخزّن صورة الحساب في videoFileId أيضاً لأن عمود النشر واحد
      const storedFileId = videoFileId || photoFileId || draft?.videoFileId;
      const next: AgentListingDraft = {
        ...draft,
        videoFileId: storedFileId,
        videoUniqueId: media.videoUniqueId ?? draft?.videoUniqueId,
        photoFileId,
        mediaKind,
        description: realDescriptionOrUndefined(payload.description) ?? draft?.description,
        price: payload.price ?? draft?.price,
        binding: payload.binding ?? draft?.binding,
      };
      await persistDraft(next);
      if (storedFileId) {
        await input.memory.clearPendingMedia(storeId, input.telegramId);
      }
      if (!next.videoFileId) {
        return {
          ok: true,
          message: "تم تجهيز مسودة إعلانك. إذا عندك فيديو أو صورة للحساب أرسلها الآن، أو أكد لي إذا تبي أنشره بدون مرفق بعد ما نكمل السعر.",
          draft: next,
        };
      }
      if (!next.price) {
        return { ok: true, message: "كم سعر الحساب بالريال؟", draft: next };
      }
      if (hasRealDescription(next.description)) {
        return publishCurrent();
      }
      if (next.videoFileId) {
        return { ok: true, message: "تمام. أرسل وصف الحساب (اللفل، السكنات، المثاليات، الربط) وأنشره لك مباشرة.", draft: next };
      }
      const mediaLabel = next.mediaKind === "photo" ? "بالصورة" : "بالفيديو";
      return {
        ok: true,
        message: `مسودة إعلانك جاهزة ${mediaLabel} وسعر ${next.price}. إذا كل شيء تمام قل «انشر» عشان أفعل الإعلان بعد التأكيد.`,
        draft: next,
      };
    },
    async updateDraft(payload) {
      if (!draft) {
        return { ok: false, message: "ما في مسودة. أرسل فيديو أو صورة الحساب أول." };
      }
      const pending = await input.memory.takePendingMedia(storeId, input.telegramId);
      const videoFileId = input.media.videoFileId || pending?.videoFileId || draft.videoFileId;
      const photoFileId = input.media.photoFileId || pending?.photoFileId || draft.photoFileId;
      const storedFileId = videoFileId || photoFileId;
      const next = {
        ...draft,
        videoFileId: storedFileId,
        videoUniqueId: input.media.videoUniqueId ?? pending?.videoUniqueId ?? draft.videoUniqueId,
        photoFileId,
        mediaKind: (videoFileId ? "video" : photoFileId ? "photo" : draft.mediaKind) as AgentListingDraft["mediaKind"],
        description: realDescriptionOrUndefined(payload.description) ?? draft.description,
        price: payload.price ?? draft.price,
        binding: payload.binding ?? draft.binding,
      };
      await persistDraft(next);
      if (storedFileId) await input.memory.clearPendingMedia(storeId, input.telegramId);
      if (next.videoFileId && next.price && hasRealDescription(next.description)) {
        // مسودة كاملة (ميديا + وصف + سعر) → نشر مباشر
        return publishCurrent();
      }
      if (next.videoFileId && hasRealDescription(next.description) && !next.price) {
        return { ok: true, message: "كم سعر الحساب بالريال؟", draft: next };
      }
      if (next.videoFileId && next.price && !hasRealDescription(next.description)) {
        return { ok: true, message: "تمام. أرسل وصف الحساب (اللفل، السكنات، المثاليات، الربط) وأنشره لك مباشرة.", draft: next };
      }
      return { ok: true, message: "عدّلت المسودة.", draft: next };
    },
    async publishListing() {
      return publishCurrent();
    },
    async markSold(shortCode: string) {
      try {
        try {
          const listing = await input.listings.markSold(shortCode, input.telegramId, storeId);
          await input.inquiries.notifyBuyersListingSold(listing.id);
          return { ok: true, message: texts.soldOk(listing.shortCode) };
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== "FORBIDDEN") throw error;
        }
        const target = await input.listings.getInquiryByShortCode(shortCode, storeId);
        if (target.sellerTelegramId === input.telegramId) {
          const listing = await input.listings.markSoldAsSystem(shortCode, input.telegramId, storeId);
          await input.inquiries.notifyBuyersListingSold(listing.id);
          return { ok: true, message: texts.sellerMarkedSold(listing.shortCode) };
        }
        return { ok: false, message: "ما تقدر تعلّم هذا الإعلان مباع." };
      } catch (error) {
        return fail(error);
      }
    },
    async deleteListing(shortCode: string) {
      try {
        const listing = await input.listings.deleteListing(shortCode, input.telegramId, storeId);
        return { ok: true, message: texts.deletedOk(listing.shortCode) };
      } catch (error) {
        return fail(error);
      }
    },
    async sellerReply(payload) {
      try {
        let inquiryId = payload.inquiryId;
        if (!inquiryId) {
          const waiting = await input.db.inquiry.findFirst({
            where: {
              status: "WAITING_SELLER",
              listing: { storeId, seller: { telegramId: input.telegramId } },
            },
            orderBy: { createdAt: "desc" },
          });
          inquiryId = waiting?.id;
        }
        if (!inquiryId) return { ok: false, message: "ما في استفسار منتظر ردك." };
        if (payload.available === false) {
          await input.inquiries.confirmSold(inquiryId, input.telegramId);
          return { ok: true, message: "تم، بلّغت المشتري إنه انباع." };
        }
        if (payload.price) {
          await input.inquiries.confirmAvailable(inquiryId, input.telegramId, payload.price);
          return { ok: true, message: "تم، أرسلت السعر للمشتري عبر المالك." };
        }
        await input.inquiries.beginAvailable(inquiryId, input.telegramId);
        return { ok: true, message: "تمام، أرسل آخر سعر برقم." };
      } catch (error) {
        return fail(error);
      }
    },
    async storeSettings(patch) {
      const hasChange = Boolean(
        patch.title || patch.ownerUsername || patch.listingFee != null || patch.paymentInstructions || patch.glossaryText,
      );
      if (!hasChange) {
        return {
          ok: true,
          message: `إعدادات ${input.store.title}: الرسوم ${input.store.listingFee} ريال. ${input.store.paymentInstructions || "ما في تعليمات دفع."}`,
        };
      }
      try {
        const glossaryText = typeof patch.glossaryText === "string" ? patch.glossaryText : undefined;
        await updateStoreSettings(input.db, {
          storeId,
          actorTelegramId: input.telegramId,
          envOwnerId: input.envOwnerId,
          title: typeof patch.title === "string" ? patch.title : undefined,
          ownerUsername: typeof patch.ownerUsername === "string" ? patch.ownerUsername : undefined,
          listingFee: typeof patch.listingFee === "number" ? patch.listingFee : undefined,
          paymentInstructions:
            typeof patch.paymentInstructions === "string" ? patch.paymentInstructions : undefined,
          customGlossary: glossaryText ? parseGlossaryText(glossaryText) : undefined,
        });
        return { ok: true, message: "تم حفظ إعدادات المتجر." };
      } catch (error) {
        return fail(error);
      }
    },
    async subscriptionStatus() {
      return { ok: true, message: `اشتراك المتجر: ${input.store.subscriptionLabel}` };
    },
    async submitReceipt(kind) {
      const photoFileId = input.media.photoFileId;
      if (!photoFileId) return { ok: false, message: "أرسل صورة الإيصال." };
      try {
        if (kind === "subscription" || isStoreAdmin(input.role)) {
          await submitSubscriptionReceipt(input.db, {
            storeId,
            payerTelegramId: input.telegramId,
            photoFileId,
            amount: input.subscriptionPriceSar,
            periodDays: input.subscriptionDays,
          });
          return { ok: true, message: "وصلت صورة الاشتراك، نراجعها." };
        }
        const listingId = await input.payments.findPendingListingId(input.telegramId, storeId);
        if (!listingId) return { ok: false, message: "ما عندك دفعة إعلان معلّقة." };
        await input.payments.submitReceipt({
          listingId,
          sellerTelegramId: input.telegramId,
          photoFileId,
        });
        return { ok: true, message: "وصلت صورة الإيصال، نراجعها." };
      } catch (error) {
        return fail(error);
      }
    },
    async listStoreListings() {
      const rows = await input.db.listing.findMany({
        where: { storeId },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { shortCode: true, status: true, price: true },
      });
      if (!rows.length) return { ok: true, message: "ما عندك إعلانات بهالمتجر بعد." };
      const lines = rows.map((row) => `${row.shortCode} · ${row.status} · ${row.price.toString()} ريال`);
      return { ok: true, message: `إعلانات المتجر (${rows.length}):\n${lines.join("\n")}` };
    },
    async listInquiries() {
      const rows = await input.db.inquiry.findMany({
        where: { listing: { storeId } },
        include: { listing: { select: { shortCode: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      if (!rows.length) return { ok: true, message: "ما فيه استفسارات بهالمتجر." };
      const lines = rows.map(
        (row) => `${row.listing.shortCode} · ${row.status} · مشتري ${row.buyerTelegramId}`,
      );
      return { ok: true, message: `آخر الاستفسارات:\n${lines.join("\n")}` };
    },
    async storeStats() {
      const stats = await getStoreStats(input.db, storeId);
      return { ok: true, message: formatStoreStats(stats) };
    },
    async listStores() {
      const rows = await listAdminStores(input.db);
      if (!rows.length) return { ok: true, message: "ما فيه متاجر." };
      const lines = rows.map(
        (row) => `@${row.botUsername || "—"} · ${row.title} · مالك ${row.ownerTelegramId || "فارغ"} · ${row.runtimeStatus}`,
      );
      return { ok: true, message: `المتاجر:\n${lines.join("\n")}` };
    },
    async ownerHelp(topic) {
      if (topic === "owner_role" || topic === "how_listing") {
        return {
          ok: true,
          message:
            "أنت المالك — تدير المتجر (إحصائيات، استفسارات، إعدادات، ربط القناة).\nالبائع يعلن من رابط دعوة البائع. المشتري يبحث ويسأل البوت.\nما نفتح مسودة بيع لك إلا إذا قلت «أبي أبيع» أو أرسلت ميديا الإعلان بنفسك.",
        };
      }
      if (topic === "bind_channel" || topic === "add_channel") {
        return {
          ok: true,
          message:
            "لربط أو تغيير القناة: بالخاص قل «اربط القناة» أو /setup، أو ضيف البوت مشرف بالمجموعة واكتب /bind داخلها.",
        };
      }
      if (topic === "unbind_channel") {
        return {
          ok: true,
          message:
            "تفك الربط؟ اكتب «فك الربط» وأأكد لك، أو من الإعدادات. بعدين تعيد الربط بنفس الطريقة.",
        };
      }
      if (topic === "commands") {
        return {
          ok: true,
          message:
            "تكلم عادي: كم إعلان، الاستفسارات، الإحصائيات، غيّر الرسوم، اربط/فك القناة. /reset يمسح المحادثة. البيع فقط إذا قلت «أبي أبيع».",
        };
      }
      return {
        ok: true,
        message:
          "تقدر تسأل: كم إعلان، الاستفسارات، الإحصائيات، غيّر الرسوم، اربط/فك القناة. /reset يمسح المحادثة العالقة.",
      };
    },
    async latestListingShortCode() {
      const row = await input.db.listing.findFirst({
        where: { storeId, status: { in: ["PUBLISHED", "DRAFT", "PENDING_PAYMENT"] } },
        orderBy: { createdAt: "desc" },
        select: { shortCode: true },
      });
      return row?.shortCode ?? null;
    },
  };
}

async function refreshUserMemory(
  deps: { db: PrismaClient; llm: LlmProvider },
  storeId: string,
  telegramId: string,
  history: { role: string; text: string }[],
  latest: string,
  focus: string | null,
) {
  const snippets = [...history.slice(-12).map((turn) => `${turn.role}: ${turn.text}`), `user: ${latest}`];
  let summary = snippets.join("\n").slice(0, 600);
  if (deps.llm.summarizeMemory && history.length >= 6) {
    try {
      const llmSummary = await deps.llm.summarizeMemory(snippets);
      if (llmSummary.trim()) summary = llmSummary.slice(0, 800);
    } catch {
      // احتفظ بالملخص اليدوي
    }
  }
  await deps.db.userMemory.upsert({
    where: { storeId_telegramId: { storeId, telegramId } },
    create: {
      storeId,
      telegramId,
      summary,
      listingsMentioned: focus ? [focus] : [],
    },
    update: {
      summary,
      listingsMentioned: focus ? [focus] : undefined,
      budgetMax: extractBudget(latest),
    },
  });
}

function extractBudget(text: string): Prisma.Decimal | undefined {
  const match = text.match(/(?:أقل من|اقل من|تحت|بأقل من)\s*(\d{2,5})/);
  if (!match) return undefined;
  return new Prisma.Decimal(match[1]);
}

/** متاجر البيع فيها عند المالك فقط — بدون ردود حالة إعلان للمستخدم */
export const OWNER_HANDLES_SALES_BOTS = ["sarhstoree_bot"];
async function isOwnerHandlesSalesStore(db: any, storeId: string): Promise<boolean> {
  try {
    const row = await db.store.findUnique({ where: { id: storeId }, select: { botUsername: true } });
    return OWNER_HANDLES_SALES_BOTS.includes(String(row?.botUsername ?? "").replace(/^@/, "").toLowerCase());
  } catch {
    return false;
  }
}
export const __test = { isOwnerHandlesSalesStore };
