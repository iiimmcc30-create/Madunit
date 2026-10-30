/** /start من يوزر يطابق ownerUsername المسجل (بدون @، حالة الأحرف مو مهمة) */
export function shouldClaimOwnerByUsername(ownerUsername?: string | null, fromUsername?: string | null): boolean {
  const a = String(ownerUsername ?? "").replace(/^@/, "").trim().toLowerCase();
  const b = String(fromUsername ?? "").replace(/^@/, "").trim().toLowerCase();
  return a.length > 0 && a === b;
}
