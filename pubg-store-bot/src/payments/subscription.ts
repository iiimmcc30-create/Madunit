/**
 * نقطة توسعة لاشتراك المتجر. التنفيذ الحالي: تحويل يدوي + إيصال.
 * Moyasar جاهز كواجهة بدون ربط مفاتيح أو استدعاء شبكة.
 */
export interface SubscriptionCharge {
  storeId: string;
  amount: number;
  currency: "SAR";
  periodDays: number;
}

export interface SubscriptionCheckout {
  url: string;
  providerRef: string;
}

export interface SubscriptionPaymentProvider {
  readonly name: string;
  readonly monthlyPriceSar: number;
  readonly periodDays: number;
  createCheckout?(charge: SubscriptionCharge): Promise<SubscriptionCheckout>;
}

export class ManualSubscriptionProvider implements SubscriptionPaymentProvider {
  readonly name = "manual-receipt";
  constructor(
    readonly monthlyPriceSar = 99,
    readonly periodDays = 30,
  ) {}
}

/** جاهز للربط لاحقًا — لا يستدعى في الإنتاج الحالي. */
export class MoyasarSubscriptionProvider implements SubscriptionPaymentProvider {
  readonly name = "moyasar";
  constructor(
    readonly monthlyPriceSar = 99,
    readonly periodDays = 30,
    readonly apiKey = "",
  ) {}

  async createCheckout(_charge: SubscriptionCharge): Promise<SubscriptionCheckout> {
    throw new Error("Moyasar is not wired yet");
  }
}

export function createSubscriptionPaymentProvider(input?: {
  monthlyPriceSar?: number;
  periodDays?: number;
}): SubscriptionPaymentProvider {
  return new ManualSubscriptionProvider(input?.monthlyPriceSar ?? 99, input?.periodDays ?? 30);
}
