-- Jita history is now kept for every type traded in The Forge. The table has
-- never been written to, so its surrogate uuid key can be swapped for the
-- natural (typeId, date) key before it grows.
DROP INDEX "ReferenceDailyStat_typeId_date_idx";
DROP INDEX "ReferenceDailyStat_typeId_date_key";
ALTER TABLE "ReferenceDailyStat" DROP CONSTRAINT "ReferenceDailyStat_pkey";
ALTER TABLE "ReferenceDailyStat" DROP COLUMN "id";
ALTER TABLE "ReferenceDailyStat" ADD CONSTRAINT "ReferenceDailyStat_pkey" PRIMARY KEY ("typeId", "date");

-- CreateTable
CREATE TABLE "ReferenceHistoryFetch" (
    "typeId" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "lastDate" TIMESTAMP(3),
    "empty" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReferenceHistoryFetch_pkey" PRIMARY KEY ("typeId")
);
