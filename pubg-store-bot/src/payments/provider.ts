/**
 * نقطة توسعة لبوابات الدفع لاحقًا (Moyasar، تلغرام Stars، ...).
 * التنفيذ الحالي: تحويل يدوي + صورة إيصال إذا كانت الرسوم أكبر من صفر.
 */
import { requiresListingReceipt } from "../domain/fee";
export interface PaymentCharge {
  listingId: string;
  amount: number;
  currency: "SAR";
}

export interface PaymentProvider {
  readonly name: string;
  requiresReceipt(amount: number): boolean;
}

export class ManualReceiptProvider implements PaymentProvider {
  readonly name = "manual-receipt";

  requiresReceipt(amount: number): boolean {
    return requiresListingReceipt(amount);
  }
}

export function createPaymentProvider(): PaymentProvider {
  return new ManualReceiptProvider();
}
