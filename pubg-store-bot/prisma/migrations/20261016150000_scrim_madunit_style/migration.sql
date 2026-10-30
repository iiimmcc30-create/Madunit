-- AlterTable
ALTER TABLE "ScrimTemplate" ADD COLUMN "rosterStartSlot" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ScrimTemplate" ADD COLUMN "rosterLineFormat" TEXT NOT NULL DEFAULT '{n}- {team}';
ALTER TABLE "ScrimTemplate" ADD COLUMN "rosterShowEmpty" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScrimTemplate" ADD COLUMN "openDetailsText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ScrimTemplate" ADD COLUMN "defaultMaps" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Scrim" ADD COLUMN "maps" TEXT[] DEFAULT ARRAY[]::TEXT[];
