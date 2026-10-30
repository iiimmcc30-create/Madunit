import { describe, expect, it } from "vitest";
import {
  createSubscriptionPaymentProvider,
  MoyasarSubscriptionProvider,
} from "./subscription";

describe("subscription payment providers", () => {
  it("uses the manual 99 SAR monthly provider by default", () => {
    const provider = createSubscriptionPaymentProvider();
    expect(provider.name).toBe("manual-receipt");
    expect(provider.monthlyPriceSar).toBe(99);
    expect(provider.periodDays).toBe(30);
  });

  it("keeps Moyasar unwired until keys are added later", async () => {
    const moyasar = new MoyasarSubscriptionProvider();
    expect(moyasar.name).toBe("moyasar");
    await expect(
      moyasar.createCheckout({
        storeId: "s1",
        amount: 99,
        currency: "SAR",
        periodDays: 30,
      }),
    ).rejects.toThrow("not wired");
  });
});
