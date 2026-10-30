export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED";
export type StorePlan = "FREE" | "MONTHLY";
export type StoreRuntimeStatus = "تجربة" | "نشط" | "منتهي" | "موقوف";

export const DEFAULT_TRIAL_HOURS = 48;
export const DEFAULT_MONTHLY_DAYS = 30;
export const DEFAULT_MONTHLY_PRICE_SAR = 99;
export const DEFAULT_REMINDER_HOURS = 12;
export const RIYADH_TZ = "Asia/Riyadh";

/** @deprecated استخدم trialExpiryHours — التجربة الافتراضية صارت 48 ساعة */
export const TRIAL_DAYS = 2;
export const MONTHLY_DAYS = DEFAULT_MONTHLY_DAYS;

export function trialExpiry(now = new Date(), days = TRIAL_DAYS): Date {
  return trialExpiryHours(now, days * 24);
}

export function trialExpiryHours(now = new Date(), hours = DEFAULT_TRIAL_HOURS): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

export function monthlyExpiry(now = new Date(), days = MONTHLY_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function extendSubscriptionExpiry(
  currentExpiry: Date | null | undefined,
  now = new Date(),
  days = MONTHLY_DAYS,
): Date {
  const base =
    currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isExpiredAt(
  expiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < now.getTime();
}

export function isSubscriptionOpen(input: {
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
  botEnabled?: boolean;
  now?: Date;
}): boolean {
  if (input.botEnabled === false) return false;
  if (input.subscriptionStatus === "EXPIRED" || input.subscriptionStatus === "CANCELED") {
    return false;
  }
  if (!input.subscriptionExpiresAt) return true;
  return input.subscriptionExpiresAt.getTime() >= (input.now ?? new Date()).getTime();
}

export function shouldRemindSubscription(input: {
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
  subscriptionRemindedAt?: Date | null;
  botEnabled?: boolean;
  now?: Date;
  reminderHours?: number;
}): boolean {
  if (!isSubscriptionOpen(input)) return false;
  if (input.subscriptionRemindedAt) return false;
  const expires = input.subscriptionExpiresAt;
  if (!expires) return false;
  const now = input.now ?? new Date();
  const windowMs = (input.reminderHours ?? DEFAULT_REMINDER_HOURS) * 60 * 60 * 1000;
  const remaining = expires.getTime() - now.getTime();
  return remaining > 0 && remaining <= windowMs;
}

export function storeRuntimeStatus(input: {
  botEnabled?: boolean;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
  now?: Date;
}): StoreRuntimeStatus {
  if (input.botEnabled === false) return "موقوف";
  if (!isSubscriptionOpen({ ...input, botEnabled: true })) return "منتهي";
  if (input.subscriptionStatus === "TRIAL") return "تجربة";
  return "نشط";
}

/** Arabic label for remaining activation days (ceil), or منتهي / بدون نهاية. */
export function remainingDaysLabel(
  expiresAt: Date | null | undefined,
  now = new Date(),
): string {
  if (!expiresAt) return "بدون نهاية";
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return "منتهي";
  const days = Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  return `${days} يوم`;
}

/** Stop date as DD/MM/YYYY in Asia/Riyadh (not raw UTC ISO). */
export function formatStopDateRiyadh(expiresAt: Date | null | undefined): string {
  if (!expiresAt) return "بدون نهاية";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: RIYADH_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(expiresAt);
  const day = parts.find((p) => p.type === "day")?.value ?? "??";
  const month = parts.find((p) => p.type === "month")?.value ?? "??";
  const year = parts.find((p) => p.type === "year")?.value ?? "????";
  return `${day}/${month}/${year}`;
}

/** True when تفعيل must ask for days first (expired / canceled / past expiresAt). */
export function needsActivationDays(input: {
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
  now?: Date;
}): boolean {
  if (input.subscriptionStatus === "EXPIRED" || input.subscriptionStatus === "CANCELED") {
    return true;
  }
  return isExpiredAt(input.subscriptionExpiresAt, input.now ?? new Date());
}

export function formatSubscription(input: {
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
  plan: StorePlan;
  botEnabled?: boolean;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const enabledLabel = input.botEnabled === false ? "موقوف" : "مفعّل";
  const remaining = remainingDaysLabel(input.subscriptionExpiresAt, now);
  const stopDate = formatStopDateRiyadh(input.subscriptionExpiresAt);
  const planLabel =
    input.plan === "MONTHLY" ? `شهرية ${DEFAULT_MONTHLY_PRICE_SAR} ريال` : "مجانية";
  return (
    `الحالة: ${enabledLabel} · ${input.subscriptionStatus}\n` +
    `باقي: ${remaining}\n` +
    `يوقف يوم: ${stopDate}\n` +
    `باقة ${planLabel}`
  );
}

export const SERVICE_STOPPED_MESSAGE = "الخدمة متوقفة مؤقتًا.";
