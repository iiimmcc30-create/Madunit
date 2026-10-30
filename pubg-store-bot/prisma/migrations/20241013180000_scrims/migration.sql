-- CreateEnum
CREATE TYPE "ScrimKind" AS ENUM ('EUROPE', 'GULF');

-- CreateEnum
CREATE TYPE "ScrimStatus" AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'LIVE', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ScrimTeamStatus" AS ENUM ('PENDING_PROOF', 'WAITING_COMMIT', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'WITHDRAWN', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "TeamTrust" AS ENUM ('TRUSTED', 'NEW', 'ABSENT');

-- CreateTable
CREATE TABLE "ScrimTemplate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "openPhotoFileId" TEXT NOT NULL DEFAULT '',
    "openCaptionEurope" TEXT NOT NULL DEFAULT '',
    "openCaptionGulf" TEXT NOT NULL DEFAULT '',
    "defaultRules" TEXT NOT NULL DEFAULT '',
    "commitAckText" TEXT NOT NULL DEFAULT '',
    "committedPhrase" TEXT NOT NULL DEFAULT 'ملتزمين',
    "lockText" TEXT NOT NULL DEFAULT '',
    "rosterTemplate" TEXT NOT NULL DEFAULT '',
    "roomIdText" TEXT NOT NULL DEFAULT '',
    "roomResultTemplate" TEXT NOT NULL DEFAULT '',
    "thanksText" TEXT NOT NULL DEFAULT '',
    "autoApproveProof" BOOLEAN NOT NULL DEFAULT false,
    "moderatorTelegramIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scoring" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrimTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scrim" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "ScrimKind" NOT NULL,
    "status" "ScrimStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAtLabel" TEXT NOT NULL,
    "maxTeams" INTEGER NOT NULL,
    "roomCount" INTEGER NOT NULL DEFAULT 1,
    "roomSecret" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL DEFAULT '',
    "channelOpenMessageId" TEXT,
    "channelLockMessageId" TEXT,
    "channelRosterMessageId" TEXT,
    "openedByTelegramId" TEXT NOT NULL,
    "rosterDraft" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scrim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrimTeam" (
    "id" TEXT NOT NULL,
    "scrimId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "leaderTelegramId" TEXT NOT NULL,
    "status" "ScrimTeamStatus" NOT NULL DEFAULT 'PENDING_PROOF',
    "rosterSlot" INTEGER,
    "waitlistSlot" INTEGER,
    "proofPhotoFileId" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrimTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrimRoom" (
    "id" TEXT NOT NULL,
    "scrimId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "roomTelegramId" TEXT NOT NULL DEFAULT '',
    "roomPassword" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "resultPhotoFileId" TEXT,
    "resultJson" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrimRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRecord" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "attended" INTEGER NOT NULL DEFAULT 0,
    "absent" INTEGER NOT NULL DEFAULT 0,
    "participations" INTEGER NOT NULL DEFAULT 0,
    "trust" "TeamTrust" NOT NULL DEFAULT 'NEW',
    "lastScrimId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScrimTemplate_storeId_key" ON "ScrimTemplate"("storeId");

-- CreateIndex
CREATE INDEX "Scrim_storeId_status_idx" ON "Scrim"("storeId", "status");

-- CreateIndex
CREATE INDEX "ScrimTeam_scrimId_status_idx" ON "ScrimTeam"("scrimId", "status");

-- CreateIndex
CREATE INDEX "ScrimTeam_storeId_leaderTelegramId_idx" ON "ScrimTeam"("storeId", "leaderTelegramId");

-- CreateIndex
CREATE UNIQUE INDEX "ScrimTeam_scrimId_tag_key" ON "ScrimTeam"("scrimId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "ScrimRoom_scrimId_index_key" ON "ScrimRoom"("scrimId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRecord_storeId_tag_key" ON "TeamRecord"("storeId", "tag");

-- AddForeignKey
ALTER TABLE "ScrimTemplate" ADD CONSTRAINT "ScrimTemplate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scrim" ADD CONSTRAINT "Scrim_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrimTeam" ADD CONSTRAINT "ScrimTeam_scrimId_fkey" FOREIGN KEY ("scrimId") REFERENCES "Scrim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrimRoom" ADD CONSTRAINT "ScrimRoom_scrimId_fkey" FOREIGN KEY ("scrimId") REFERENCES "Scrim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRecord" ADD CONSTRAINT "TeamRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
