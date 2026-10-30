-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "budgetMax" DECIMAL(12,2),
    "wantedSkins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listingsMentioned" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_storeId_telegramId_key" ON "UserMemory"("storeId", "telegramId");

-- CreateIndex
CREATE INDEX "UserMemory_telegramId_idx" ON "UserMemory"("telegramId");

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
