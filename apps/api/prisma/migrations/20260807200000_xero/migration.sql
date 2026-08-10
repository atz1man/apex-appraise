-- AlterTable
ALTER TABLE "CostPackage" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "XeroConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "trackingCategoryId" TEXT,
    "trackingCategoryName" TEXT,

    CONSTRAINT "XeroConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XeroDealMap" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "trackingOptionId" TEXT NOT NULL,
    "trackingOptionName" TEXT NOT NULL,

    CONSTRAINT "XeroDealMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "XeroConnection_orgId_key" ON "XeroConnection"("orgId");

-- CreateIndex
CREATE INDEX "XeroDealMap_orgId_dealId_idx" ON "XeroDealMap"("orgId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "XeroDealMap_orgId_trackingOptionId_key" ON "XeroDealMap"("orgId", "trackingOptionId");

