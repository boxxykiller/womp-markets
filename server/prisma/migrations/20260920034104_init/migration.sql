-- CreateTable
CREATE TABLE "EveCharacter" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "characterId" TEXT NOT NULL,
    "characterName" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenType" TEXT,
    "scopes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "corporationId" TEXT,
    "corporationName" TEXT,
    "allianceId" TEXT,
    "allianceName" TEXT,
    "affiliationCheckedAt" TIMESTAMP(3),
    "role" TEXT NOT NULL DEFAULT 'user',
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "connectedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastRefreshAt" TIMESTAMP(3),

    CONSTRAINT "EveCharacter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'login',
    "ownerKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SdeMeta" (
    "id" TEXT NOT NULL,
    "buildNumber" INTEGER NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "datasetCounts" JSONB NOT NULL,

    CONSTRAINT "SdeMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SdeRecord" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "SdeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSource" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "structureId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'structure',
    "name" TEXT,
    "systemId" INTEGER,
    "systemName" TEXT,
    "regionId" INTEGER,
    "regionName" TEXT,
    "readerCharacterId" TEXT,
    "readerCharacterName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "pollIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "retentionDays" INTEGER NOT NULL DEFAULT 180,
    "lastPolledAt" TIMESTAMP(3),
    "lastPollStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastPollError" TEXT,
    "nextPollAt" TIMESTAMP(3),

    CONSTRAINT "MarketSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOrder" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "structureId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "isBuyOrder" BOOLEAN NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "volumeRemain" DOUBLE PRECISION NOT NULL,
    "volumeTotal" DOUBLE PRECISION NOT NULL,
    "minVolume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "range" TEXT,
    "duration" INTEGER,
    "issued" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOrderArchive" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "isBuyOrder" BOOLEAN NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "volumeRemain" DOUBLE PRECISION NOT NULL,
    "volumeTotal" DOUBLE PRECISION NOT NULL,
    "issued" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endState" TEXT NOT NULL,

    CONSTRAINT "MarketOrderArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketOrderEvent" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "orderId" TEXT,
    "isBuyOrder" BOOLEAN,
    "eventType" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "prevPrice" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDailyStat" (
    "id" TEXT NOT NULL,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "structureId" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "unitsSoldConfirmed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitsSoldEstimated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "iskTradedConfirmed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "iskTradedEstimated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lowSell" DOUBLE PRECISION,
    "highBuy" DOUBLE PRECISION,
    "endSellVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "endBuyVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellOrderCount" INTEGER NOT NULL DEFAULT 0,
    "buyOrderCount" INTEGER NOT NULL DEFAULT 0,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketWatchItem" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "structureId" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "itemName" TEXT,
    "minQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minDaysCover" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetQuantity" DOUBLE PRECISION,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "MarketWatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "sellVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "buyVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bestSell" DOUBLE PRECISION,
    "bestBuy" DOUBLE PRECISION,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferencePrice" (
    "id" TEXT NOT NULL,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "typeId" INTEGER NOT NULL,
    "bestBuy" DOUBLE PRECISION,
    "bestSell" DOUBLE PRECISION,
    "buyVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medianBuy" DOUBLE PRECISION,
    "medianSell" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'fuzzwork',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferencePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceDailyStat" (
    "id" TEXT NOT NULL,
    "typeId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "average" DOUBLE PRECISION,
    "highest" DOUBLE PRECISION,
    "lowest" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderCount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "EveCharacter_characterId_key" ON "EveCharacter"("characterId");

-- CreateIndex
CREATE INDEX "EveCharacter_ownerKey_idx" ON "EveCharacter"("ownerKey");

-- CreateIndex
CREATE INDEX "EveCharacter_corporationId_idx" ON "EveCharacter"("corporationId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_nonce_key" ON "OAuthState"("nonce");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SdeMeta_buildNumber_key" ON "SdeMeta"("buildNumber");

-- CreateIndex
CREATE INDEX "SdeRecord_dataset_idx" ON "SdeRecord"("dataset");

-- CreateIndex
CREATE UNIQUE INDEX "SdeRecord_dataset_key_key" ON "SdeRecord"("dataset", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSource_structureId_key" ON "MarketSource"("structureId");

-- CreateIndex
CREATE INDEX "MarketOrder_structureId_typeId_idx" ON "MarketOrder"("structureId", "typeId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOrder_structureId_orderId_key" ON "MarketOrder"("structureId", "orderId");

-- CreateIndex
CREATE INDEX "MarketOrderArchive_structureId_typeId_removedAt_idx" ON "MarketOrderArchive"("structureId", "typeId", "removedAt");

-- CreateIndex
CREATE INDEX "MarketOrderArchive_structureId_removedAt_idx" ON "MarketOrderArchive"("structureId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketOrderArchive_structureId_orderId_removedAt_key" ON "MarketOrderArchive"("structureId", "orderId", "removedAt");

-- CreateIndex
CREATE INDEX "MarketOrderEvent_structureId_typeId_occurredAt_idx" ON "MarketOrderEvent"("structureId", "typeId", "occurredAt");

-- CreateIndex
CREATE INDEX "MarketOrderEvent_structureId_occurredAt_idx" ON "MarketOrderEvent"("structureId", "occurredAt");

-- CreateIndex
CREATE INDEX "MarketDailyStat_structureId_date_idx" ON "MarketDailyStat"("structureId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDailyStat_structureId_typeId_date_key" ON "MarketDailyStat"("structureId", "typeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketWatchItem_structureId_typeId_key" ON "MarketWatchItem"("structureId", "typeId");

-- CreateIndex
CREATE INDEX "MarketSnapshot_structureId_typeId_takenAt_idx" ON "MarketSnapshot"("structureId", "typeId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferencePrice_typeId_key" ON "ReferencePrice"("typeId");

-- CreateIndex
CREATE INDEX "ReferenceDailyStat_typeId_date_idx" ON "ReferenceDailyStat"("typeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceDailyStat_typeId_date_key" ON "ReferenceDailyStat"("typeId", "date");
