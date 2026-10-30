-- AlterTable
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "tradersGroupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Store_tradersGroupId_key" ON "Store"("tradersGroupId");
