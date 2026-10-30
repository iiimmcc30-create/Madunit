-- AlterTable
ALTER TABLE "ScrimTemplate" ADD COLUMN "dropsGroupId" TEXT;
ALTER TABLE "ScrimTemplate" ADD COLUMN "dropsUnlockLeadMinutes" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "ScrimTemplate" ADD COLUMN "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScrimTemplate" ADD COLUMN "scheduleTime" TEXT;
ALTER TABLE "ScrimTemplate" ADD COLUMN "scheduleKind" "ScrimKind";
ALTER TABLE "ScrimTemplate" ADD COLUMN "scheduleMaxTeams" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "ScrimTemplate" ADD COLUMN "scheduleRoomCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ScrimTemplate" ADD COLUMN "scheduleOpenLeadMinutes" INTEGER NOT NULL DEFAULT 180;
ALTER TABLE "ScrimTemplate" ADD COLUMN "scheduleLastRunKey" TEXT;

-- AlterTable
ALTER TABLE "Scrim" ADD COLUMN "startsAt" TIMESTAMP(3);
ALTER TABLE "Scrim" ADD COLUMN "dropsUnlockedAt" TIMESTAMP(3);
ALTER TABLE "Scrim" ADD COLUMN "dropsLockedAt" TIMESTAMP(3);
ALTER TABLE "Scrim" ADD COLUMN "remind30At" TIMESTAMP(3);
ALTER TABLE "Scrim" ADD COLUMN "remind5At" TIMESTAMP(3);
