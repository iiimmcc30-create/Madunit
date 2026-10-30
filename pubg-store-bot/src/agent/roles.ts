export type AgentRole = "super_admin" | "owner" | "seller" | "buyer";

export const SENSITIVE_TOOLS = new Set([
  "publish_listing",
  "delete_listing",
  "mark_sold",
  "submit_payment_receipt",
  "store_settings",
]);

const BUYER_TOOLS = new Set([
  "search_listings",
  "get_listing",
  "create_inquiry",
  "save_buyer_request",
  "ask_clarification",
]);

const SELLER_TOOLS = new Set([
  ...BUYER_TOOLS,
  "start_listing",
  "update_listing_draft",
  "publish_listing",
  "mark_sold",
  "delete_listing",
  "seller_reply",
  "submit_payment_receipt",
]);

const OWNER_TOOLS = new Set([
  ...SELLER_TOOLS,
  "store_settings",
  "subscription_status",
  "list_store_listings",
  "list_inquiries",
  "store_stats",
  "owner_help",
]);

const SUPER_ADMIN_TOOLS = new Set([...OWNER_TOOLS, "list_stores"]);

export function isStoreAdmin(role: AgentRole): boolean {
  return role === "owner" || role === "super_admin";
}

export function resolveActorRole(input: {
  telegramId: string;
  storeOwnerTelegramId: string;
  superAdminTelegramId: string;
  envOwnerTelegramId: string;
  isSellerOnStore: boolean;
}): AgentRole {
  const id = String(input.telegramId ?? "").trim();
  if (!id) return "buyer";
  const superAdmin = String(input.superAdminTelegramId ?? "").trim();
  const envOwner = String(input.envOwnerTelegramId ?? "").trim();
  if ((superAdmin && id === superAdmin) || (envOwner && id === envOwner)) return "super_admin";
  const storeOwner = String(input.storeOwnerTelegramId ?? "").trim();
  if (storeOwner && id === storeOwner) return "owner";
  if (input.isSellerOnStore) return "seller";
  return "buyer";
}

export function rolePromptLabel(role: AgentRole): string {
  switch (role) {
    case "super_admin":
      return "المتحدث هو صاحب المنصة (سوبر أدمن) وقد يكون مالك هذا المتجر أيضًا، وليس عميلًا. لا تعاملّه كزبون يبحث عن حساب، ولا تعرض «تبي تعرض حساب؟» إلا إذا طلب البيع صراحة.";
    case "owner":
      return "المتحدث هو مالك هذا المتجر/هذه القناة، وليس عميلًا. لا تعرض عليه مسار «تبي تعرض حساب؟» أو البحث للشراء إلا إذا طلب ذلك صراحة.";
    case "seller":
      return "المتحدث بائع في هذا المتجر (يعرض/ينشر حسابات). إذا قال إنه يسأل أو يشوف فقط، عامله حسب قصده.";
    default:
      return "المتحدث عميل/مشتري افتراضيًا. ميّز: شراء، سؤال فقط، أو تصفح/يشوف إعلان — من كلامه. إذا قال إنه بائع أو أرسل إعلان، حوّل لمسار البيع.";
  }
}

export function canRunTool(tool: string, role: AgentRole): boolean {
  return toolsForRole(role).has(tool);
}

export function toolsForRole(role: AgentRole): Set<string> {
  if (role === "super_admin") return SUPER_ADMIN_TOOLS;
  if (role === "owner") return OWNER_TOOLS;
  if (role === "seller") return SELLER_TOOLS;
  return BUYER_TOOLS;
}

export function toolDeniedMessage(tool: string, role: AgentRole): string {
  if (role === "buyer" && SELLER_TOOLS.has(tool)) {
    return "أرسل فيديو أو صور الحساب مع الوصف والسعر عشان نفتح مسودة الإعلان هنا. الإعلان ينزل باسم المالك.";
  }
  return `ما عندك صلاحية لـ ${tool}.`;
}

export function isSensitiveTool(tool: string): boolean {
  return SENSITIVE_TOOLS.has(tool);
}

export function listingFlowTools(): Set<string> {
  return new Set([
    "start_listing",
    "update_listing_draft",
    "publish_listing",
    "submit_payment_receipt",
  ]);
}
