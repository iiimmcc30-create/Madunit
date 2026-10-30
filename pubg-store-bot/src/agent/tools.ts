import type { AgentToolSpec } from "../llm/types";
import type { PublicListing } from "./public-listing";
import type { ListingSearchFilters } from "./search";
import type { OpenInquiryResult } from "../services/inquiry";
import { toolsForRole, type AgentRole } from "./roles";

export const AGENT_TOOL_SPECS: AgentToolSpec[] = [
  {
    name: "search_listings",
    description:
      "ابحث في الإعلانات المنشورة لنفس المتجر فقط وأرجع أنسب 3. لأسئلة مثل «عندكم ثلجي بأقل من 500» أو «كم آخره» بدون رقم بعد ما تحدّد السياق.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxPrice: { type: "number" },
        minPrice: { type: "number" },
        skins: { type: "array", items: { type: "string" } },
        binding: { type: "string" },
      },
    },
  },
  {
    name: "get_listing",
    description: "تفاصيل إعلان منشور برقم قصير مثل A001. لا تُرجع بيانات البائع. «لا الثاني» يعني ثاني نتيجة بحث سابقة.",
    parameters: {
      type: "object",
      properties: { shortCode: { type: "string" }, index: { type: "number" } },
    },
  },
  {
    name: "create_inquiry",
    description: "افتح استفسار توفر/آخر سعر لإعلان. استخدم رقم السياق إذا قال «هذا» أو «آخر سعر» بدون رقم.",
    parameters: {
      type: "object",
      properties: { shortCode: { type: "string" } },
    },
  },
  {
    name: "save_buyer_request",
    description: "سجّل طلب المشتري ليُبلَّغ عند نزول إعلان مطابق.",
    parameters: {
      type: "object",
      properties: {
        budgetMax: { type: "number" },
        skins: { type: "array", items: { type: "string" } },
        binding: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "start_listing",
    description:
      "ابدأ مسودة إعلان بيع. الفيديو/الصورة المرفقة تُؤخذ من الرسالة الحالية تلقائيًا. لا تخترع file id.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        price: { type: "number" },
        binding: { type: "string" },
      },
    },
  },
  {
    name: "update_listing_draft",
    description: "حدّث مسودة الإعلان الحالية (وصف، سعر، ربط).",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        price: { type: "number" },
        binding: { type: "string" },
      },
    },
  },
  {
    name: "publish_listing",
    description: "انشر المسودة الحالية. التنفيذ يحتاج تأكيد من المستخدم في الكود.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "seller_reply",
    description: "رد البائع على استفسار انتظار: متوفر مع سعر، أو مباع.",
    parameters: {
      type: "object",
      properties: {
        available: { type: "boolean" },
        price: { type: "number" },
        inquiryId: { type: "string" },
      },
    },
  },
  {
    name: "mark_sold",
    description: "علّم إعلان مباع. يحتاج صلاحية وتأكيد.",
    parameters: {
      type: "object",
      properties: { shortCode: { type: "string" } },
    },
  },
  {
    name: "delete_listing",
    description: "احذف إعلان. يحتاج صلاحية وتأكيد.",
    parameters: {
      type: "object",
      properties: { shortCode: { type: "string" } },
    },
  },
  {
    name: "store_settings",
    description: "اقرأ أو عدّل إعدادات المتجر للمالك: عنوان، يوزر، رسوم، تعليمات دفع، قالب، معجم.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        ownerUsername: { type: "string" },
        listingFee: { type: "number" },
        paymentInstructions: { type: "string" },
        glossaryText: { type: "string" },
      },
    },
  },
  {
    name: "subscription_status",
    description: "حالة اشتراك المتجر للمالك: تجربة/نشط/منتهي والمتبقي.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "submit_payment_receipt",
    description: "سجّل إيصال دفع. الصورة المرفقة تُؤخذ من الرسالة. يحتاج تأكيد.",
    parameters: {
      type: "object",
      properties: { kind: { type: "string", enum: ["listing", "subscription"] } },
    },
  },
  {
    name: "list_store_listings",
    description:
      "للمالك: قائمة إعلانات هذا المتجر (منشور/مسودة/مباع) مع الأرقام. استخدمها لأسئلة مثل «كم إعلان عندي؟» أو «ورني إعلاناتي».",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_inquiries",
    description: "للمالك: آخر الاستفسارات المعلقة والردود. «وش آخر الاستفسارات؟».",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "store_stats",
    description: "للمالك: إحصائيات المتجر: عدد الإعلانات، الاستفسارات، الإيصالات، الاشتراك.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_stores",
    description: "لصاحب المنصة: قائمة المتاجر/البوتات المرتبطة وحالة كل واحد.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "owner_help",
    description:
      "شرح تشغيلي للمالك: إضافة قناة/بوت ثاني، الأوامر، بدون معاملته كزبون. topic مثل add_channel أو commands.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string" } },
    },
  },
  {
    name: "ask_clarification",
    description: "اسأل سؤال توضيحي واحد قصير إذا الطلب غامض فعلًا. لا تعرض قائمة خيارات، ولا تسأل المالك هل يبي يشتري.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
];

export interface AgentMedia {
  photoFileId?: string;
  videoFileId?: string;
  videoUniqueId?: string;
  voiceFileId?: string;
  imageDataUrl?: string;
  transcribedText?: string;
}

export interface AgentListingDraft {
  listingId?: string;
  videoFileId?: string;
  videoUniqueId?: string | null;
  /** صورة الحساب إن ما فيه فيديو — تُخزَّن في telegramVideoFileId عند النشر */
  photoFileId?: string;
  mediaKind?: "video" | "photo";
  description?: string;
  price?: number;
  binding?: string;
}

export interface PendingAgentConfirm {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface AgentToolRuntime {
  ownerUsername: string;
  role: AgentRole;
  confirmed: boolean;
  media: AgentMedia;
  draft: AgentListingDraft | null;
  lastSearchCodes: string[];
  longTermSummary: string;
  focusShortCode: string | null;
  searchListings(filters: ListingSearchFilters): Promise<PublicListing[]>;
  getListing(shortCode: string): Promise<PublicListing | null>;
  createInquiry(shortCode: string): Promise<OpenInquiryResult>;
  saveBuyerRequest(input: {
    budgetMax?: number | null;
    skins?: string[];
    binding?: string | null;
    notes?: string;
  }): Promise<{ ok: boolean; message: string }>;
  setFocus(shortCode: string): Promise<void>;
  setLastSearchCodes?(codes: string[]): Promise<void>;
  startListing?(input: {
    description?: string;
    price?: number;
    binding?: string;
  }): Promise<{ ok: boolean; message: string; draft?: AgentListingDraft }>;
  updateDraft?(input: {
    description?: string;
    price?: number;
    binding?: string;
  }): Promise<{ ok: boolean; message: string; draft?: AgentListingDraft }>;
  publishListing?(): Promise<{ ok: boolean; message: string; shortCode?: string }>;
  markSold?(shortCode: string): Promise<{ ok: boolean; message: string }>;
  deleteListing?(shortCode: string): Promise<{ ok: boolean; message: string }>;
  sellerReply?(input: {
    available?: boolean;
    price?: number;
    inquiryId?: string;
  }): Promise<{ ok: boolean; message: string }>;
  storeSettings?(patch: Record<string, unknown>): Promise<{ ok: boolean; message: string }>;
  subscriptionStatus?(): Promise<{ ok: boolean; message: string }>;
  submitReceipt?(kind?: string): Promise<{ ok: boolean; message: string }>;
  listStoreListings?(): Promise<{ ok: boolean; message: string }>;
  listInquiries?(): Promise<{ ok: boolean; message: string }>;
  storeStats?(): Promise<{ ok: boolean; message: string }>;
  listStores?(): Promise<{ ok: boolean; message: string }>;
  ownerHelp?(topic?: string): Promise<{ ok: boolean; message: string }>;
  latestListingShortCode?(): Promise<string | null>;
}

export const CLARIFY_QUESTION =
  "تمام، قولي وش تبي وأساعدك.";
export const OWNER_CLARIFY_QUESTION =
  "تمام، قولي وش تبي للمتجر وأضبطه لك.";

export function toolSpecsForRole(role: AgentRole): AgentToolSpec[] {
  const allowed = toolsForRole(role);
  return AGENT_TOOL_SPECS.filter((tool) => allowed.has(tool.name));
}
