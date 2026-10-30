-- Manual (non-CJ) products and fulfilment. Additive + defaults => backwards compatible.
ALTER TABLE "Product" ADD COLUMN "supplier" TEXT NOT NULL DEFAULT 'cj';
ALTER TABLE "Product" ADD COLUMN "compareAtSar" DECIMAL(12,2);
ALTER TABLE "Product" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "manualFulfilment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "manualTracking" TEXT;
ALTER TABLE "Order" ADD COLUMN "manualShippedAt" TIMESTAMP(3);
