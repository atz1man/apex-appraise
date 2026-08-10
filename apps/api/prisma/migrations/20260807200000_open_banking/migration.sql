-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'truelayer',
    "institution" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consentExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "dealId" TEXT,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL,
    "amount" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'unclassified',
    "classifiedById" TEXT,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_orgId_key" ON "BankConnection"("orgId");

-- CreateIndex
CREATE INDEX "BankAccount_orgId_idx" ON "BankAccount"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_connectionId_externalId_key" ON "BankAccount"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "BankTransaction_orgId_bookedAt_idx" ON "BankTransaction"("orgId", "bookedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_accountId_externalId_key" ON "BankTransaction"("accountId", "externalId");

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

