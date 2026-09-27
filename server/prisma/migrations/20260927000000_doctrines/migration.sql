-- CreateTable
CREATE TABLE "Doctrine" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minQuantity" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Doctrine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctrineFit" (
    "id" TEXT NOT NULL,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "doctrineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shipTypeId" INTEGER NOT NULL,
    "shipName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'main',
    "minQuantity" INTEGER,
    "includeCargo" BOOLEAN NOT NULL DEFAULT true,
    "eft" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "unmatched" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DoctrineFit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoctrineFit_doctrineId_idx" ON "DoctrineFit"("doctrineId");
