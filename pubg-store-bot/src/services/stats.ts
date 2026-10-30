import type { PrismaClient } from "@prisma/client";
import { countReferrals } from "./referral";
import { getStoreById, type StoreView } from "./store";

export interface StoreStats {
  store: StoreView;
  listings: { draft: number; pendingPayment: number; published: number; sold: number };
  inquiries: { waiting: number; available: number; timeout: number };
  payments: { pending: number; confirmed: number; rejected: number; confirmedAmount: number };
  referrals: { sellers: number; buyers: number };
}

export async function getStoreStats(db: PrismaClient, storeId: string): Promise<StoreStats> {
  const store = await getStoreById(db, storeId);
  const [draft, pendingPayment, published, sold, waiting, available, timeout, pendingPay, confirmed, rejected, confirmedSum, referrals] =
    await Promise.all([
      db.listing.count({ where: { storeId, status: "DRAFT" } }),
      db.listing.count({ where: { storeId, status: "PENDING_PAYMENT" } }),
      db.listing.count({ where: { storeId, status: "PUBLISHED" } }),
      db.listing.count({ where: { storeId, status: "SOLD" } }),
      db.inquiry.count({ where: { status: "WAITING_SELLER", listing: { storeId } } }),
      db.inquiry.count({ where: { status: "AVAILABLE", listing: { storeId } } }),
      db.inquiry.count({ where: { status: "TIMEOUT", listing: { storeId } } }),
      db.payment.count({ where: { status: "PENDING", listing: { storeId } } }),
      db.payment.count({ where: { status: "CONFIRMED", listing: { storeId } } }),
      db.payment.count({ where: { status: "REJECTED", listing: { storeId } } }),
      db.payment.aggregate({
        where: { status: "CONFIRMED", listing: { storeId } },
        _sum: { amount: true },
      }),
      countReferrals(db, storeId),
    ]);

  return {
    store,
    listings: { draft, pendingPayment, published, sold },
    inquiries: { waiting, available, timeout },
    payments: {
      pending: pendingPay,
      confirmed,
      rejected,
      confirmedAmount: confirmedSum._sum.amount?.toNumber() ?? 0,
    },
    referrals,
  };
}

export function formatStoreStats(stats: StoreStats): string {
  return [
    `إحصائيات ${stats.store.title}`,
    `الاشتراك: ${stats.store.subscriptionLabel}`,
    `الإعلانات: مسودة ${stats.listings.draft} · انتظار دفع ${stats.listings.pendingPayment} · منشور ${stats.listings.published} · مباع ${stats.listings.sold}`,
    `الاستفسارات: انتظار ${stats.inquiries.waiting} · متوفر ${stats.inquiries.available} · مهلة ${stats.inquiries.timeout}`,
    `الإيصالات: انتظار ${stats.payments.pending} · مؤكد ${stats.payments.confirmed} · مرفوض ${stats.payments.rejected}`,
    `رسوم مؤكدة: ${stats.payments.confirmedAmount} ريال`,
    `الإحالات: بائعون ${stats.referrals.sellers} · مشترين ${stats.referrals.buyers}`,
  ].join("\n");
}
