import type { AgentRole } from "../agent/roles";
import type { EvalCase } from "./corpus";

export interface EvalTurn extends EvalCase {
  afterDraft?: boolean;
  afterFocus?: string | null;
}

export const OWNER_MULTI_TURN: EvalTurn[] = [
  { id: "om1", text: "كم إعلان عندي؟", expect: "list_store_listings", role: "owner" },
  { id: "om2", text: "وش آخر الاستفسارات؟", expect: "list_inquiries", role: "owner" },
  { id: "om3", text: "احذف آخر إعلان", expect: "delete_listing", role: "owner" },
  { id: "om4", text: "غيّر الرسوم لـ 10", expect: "store_settings", role: "owner" },
  { id: "om5", text: "كيف أضيف قناة ثانية؟", expect: "owner_help", role: "owner" },
  { id: "om6", text: "والإحصائيات؟", expect: "store_stats", role: "owner" },
];

export const OWNER_STUCK_DRAFT: EvalTurn[] = [
  {
    id: "od1",
    text: "120",
    expect: "update_listing_draft",
    role: "owner",
    draft: true,
  },
  {
    id: "od2",
    text: "كم إعلان عندي؟",
    expect: "list_store_listings",
    role: "owner",
    draft: true,
  },
  {
    id: "od3",
    text: "وش آخر الاستفسارات؟",
    expect: "list_inquiries",
    role: "owner",
    draft: true,
  },
];

export const BUYER_MULTI_TURN: EvalTurn[] = [
  { id: "bm1", text: "عندكم حساب فيه مثالية الثلجي بأقل من 500؟", expect: "search_listings", role: "buyer" },
  {
    id: "bm2",
    text: "طيب وكم آخر سعر؟",
    expect: "create_inquiry",
    role: "buyer",
    focus: "A001",
  },
  { id: "bm3", text: "بلغني إذا نزل اكس سوت تحت 700", expect: "save_buyer_request", role: "buyer" },
];

export const SELLER_MULTI_TURN: EvalTurn[] = [
  { id: "sm1", text: "أبي أبيع حساب", expect: "start_listing", role: "seller" },
  { id: "sm2", text: "150", expect: "update_listing_draft", role: "seller", draft: true },
  { id: "sm3", text: "انشر", expect: "publish_listing", role: "seller", draft: true },
];

export const SUPER_ADMIN_MULTI_TURN: EvalTurn[] = [
  { id: "sa1", text: "كم إعلان عندي؟", expect: "list_store_listings", role: "super_admin" },
  { id: "sa2", text: "المتاجر", expect: "list_stores", role: "super_admin" },
  { id: "sa3", text: "كيف أضيف قناة ثانية؟", expect: "owner_help", role: "super_admin" },
];

/** حالات كانت تفشل قبل إصلاح الدور — تبقى فاشلة إذا نُفذت بدور مشتري. */
export const PREVIOUS_OWNER_FAILURES_AS_BUYER: EvalTurn[] = [
  { id: "fail1", text: "كم إعلان عندي؟", expect: "list_store_listings", role: "buyer" },
  { id: "fail2", text: "وش آخر الاستفسارات؟", expect: "list_inquiries", role: "buyer" },
  { id: "fail3", text: "كيف أضيف قناة ثانية؟", expect: "owner_help", role: "buyer" },
];
