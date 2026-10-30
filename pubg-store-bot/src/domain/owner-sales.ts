/** متاجر البيع والحالة فيها عند المالك فقط — البوت ما يرد عن انباع/محجوز/منشور قبل */
export const OWNER_HANDLES_SALES_BOTS = ["sarhstoree_bot"];
export function ownerHandlesSales(botUsername?: string | null): boolean {
  return OWNER_HANDLES_SALES_BOTS.includes(String(botUsername ?? "").replace(/^@/, "").trim().toLowerCase());
}
