import { describe, expect, it } from "vitest";
import {
  extendSubscriptionExpiry,
  formatStopDateRiyadh,
  formatSubscription,
  isSubscriptionOpen,
  needsActivationDays,
  remainingDaysLabel,
  shouldRemindSubscription,
  storeRuntimeStatus,
  trialExpiryHours,
} from "./subscription";

describe("store subscription", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("keeps a 48-hour trial open then closes after expiry", () => {
    const expires = trialExpiryHours(now, 48);
    expect(
      isSubscriptionOpen({
        subscriptionStatus: "TRIAL",
        subscriptionExpiresAt: expires,
        now,
      }),
    ).toBe(true);
    expect(
      isSubscriptionOpen({
        subscriptionStatus: "TRIAL",
        subscriptionExpiresAt: expires,
        now: new Date(expires.getTime() + 1000),
      }),
    ).toBe(false);
    expect(storeRuntimeStatus({ subscriptionStatus: "TRIAL", subscriptionExpiresAt: expires, now })).toBe(
      "تجربة",
    );
  });

  it("extends 30 days from the later of expiry or today", () => {
    const future = new Date("2026-11-01T00:00:00.000Z");
    const fromFuture = extendSubscriptionExpiry(future, now, 30);
    expect(fromFuture.toISOString().slice(0, 10)).toBe("2026-12-01");
    const fromPast = extendSubscriptionExpiry(new Date("2026-01-01T00:00:00.000Z"), now, 30);
    expect(fromPast.toISOString().slice(0, 10)).toBe("2026-11-12");
  });

  it("reminds 12 hours before the end, once", () => {
    const expires = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    expect(
      shouldRemindSubscription({
        subscriptionStatus: "TRIAL",
        subscriptionExpiresAt: expires,
        now,
        reminderHours: 12,
      }),
    ).toBe(true);
    expect(
      shouldRemindSubscription({
        subscriptionStatus: "TRIAL",
        subscriptionExpiresAt: expires,
        subscriptionRemindedAt: now,
        now,
        reminderHours: 12,
      }),
    ).toBe(false);
  });

  it("marks suspended bots as موقوف even during trial", () => {
    expect(
      storeRuntimeStatus({
        botEnabled: false,
        subscriptionStatus: "TRIAL",
        subscriptionExpiresAt: trialExpiryHours(now, 48),
        now,
      }),
    ).toBe("موقوف");
    expect(
      isSubscriptionOpen({
        botEnabled: false,
        subscriptionStatus: "ACTIVE",
        subscriptionExpiresAt: trialExpiryHours(now, 48),
        now,
      }),
    ).toBe(false);
  });

  it("describes the plan in Arabic with remaining days and Riyadh stop date", () => {
    const label = formatSubscription({
      subscriptionStatus: "TRIAL",
      plan: "MONTHLY",
      botEnabled: true,
      subscriptionExpiresAt: new Date("2026-10-16T21:00:00.000Z"),
      now: new Date("2026-10-13T12:00:00.000Z"),
    });
    expect(label).toContain("الحالة: مفعّل · TRIAL");
    expect(label).toContain("باقي:");
    expect(label).toContain("يوقف يوم:");
    expect(label).toContain("باقة شهرية");
  });
});

describe("remainingDaysLabel", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("returns بدون نهاية when no expiry", () => {
    expect(remainingDaysLabel(null, now)).toBe("بدون نهاية");
    expect(remainingDaysLabel(undefined, now)).toBe("بدون نهاية");
  });

  it("returns منتهي when expiry is in the past", () => {
    expect(remainingDaysLabel(new Date("2026-10-10T00:00:00.000Z"), now)).toBe("منتهي");
  });

  it("ceils remaining time to whole days", () => {
    // 2.5 days → 3 يوم
    expect(remainingDaysLabel(new Date(now.getTime() + 2.5 * 24 * 60 * 60 * 1000), now)).toBe(
      "3 يوم",
    );
    // exactly 30 days
    expect(remainingDaysLabel(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), now)).toBe(
      "30 يوم",
    );
    // a few hours left → 1 يوم
    expect(remainingDaysLabel(new Date(now.getTime() + 3 * 60 * 60 * 1000), now)).toBe("1 يوم");
  });
});

describe("formatStopDateRiyadh", () => {
  it("formats as DD/MM/YYYY in Asia/Riyadh", () => {
    // 2026-10-16T21:00:00Z = 2026-10-17 00:00 Asia/Riyadh (UTC+3)
    expect(formatStopDateRiyadh(new Date("2026-10-16T21:00:00.000Z"))).toBe("17/10/2026");
    expect(formatStopDateRiyadh(null)).toBe("بدون نهاية");
  });
});

describe("needsActivationDays", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("is true for EXPIRED/CANCELED or past expiry", () => {
    expect(needsActivationDays({ subscriptionStatus: "EXPIRED", now })).toBe(true);
    expect(needsActivationDays({ subscriptionStatus: "CANCELED", now })).toBe(true);
    expect(
      needsActivationDays({
        subscriptionStatus: "ACTIVE",
        subscriptionExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
        now,
      }),
    ).toBe(true);
  });

  it("is false for open trial/active", () => {
    expect(
      needsActivationDays({
        subscriptionStatus: "TRIAL",
        subscriptionExpiresAt: new Date("2026-10-20T00:00:00.000Z"),
        now,
      }),
    ).toBe(false);
  });
});
