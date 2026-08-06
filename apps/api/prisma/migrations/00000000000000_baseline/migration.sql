-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'TRIAL',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ANALYST',
    "principalType" TEXT NOT NULL DEFAULT 'internal',
    "initials" TEXT NOT NULL,
    "investorId" TEXT,
    "buyerUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "postcode" TEXT,
    "assetType" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'SOURCING',
    "figureStatus" TEXT NOT NULL DEFAULT 'ESTIMATE',
    "probability" INTEGER NOT NULL DEFAULT 50,
    "gdv" BIGINT NOT NULL DEFAULT 0,
    "forecastProfit" BIGINT NOT NULL DEFAULT 0,
    "roc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "equityRequired" BIGINT NOT NULL DEFAULT 0,
    "viability" TEXT NOT NULL DEFAULT 'CAUTION',
    "nextMilestone" TEXT,
    "nextMilestoneDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appraisal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT NOT NULL DEFAULT 'Base',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "efficiency" DOUBLE PRECISION NOT NULL DEFAULT 90,
    "units" TEXT NOT NULL,
    "trades" TEXT NOT NULL,
    "otherCosts" TEXT NOT NULL,
    "profFeePct" DOUBLE PRECISION NOT NULL DEFAULT 11,
    "contingencyPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "ltcPct" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "ratePct" DOUBLE PRECISION NOT NULL DEFAULT 7.5,
    "periodMonths" INTEGER NOT NULL DEFAULT 18,
    "salesMonths" INTEGER NOT NULL DEFAULT 3,
    "arrangementFeePct" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "drawFactorPct" DOUBLE PRECISION NOT NULL DEFAULT 55,
    "absorptionUnitsPerMonth" DOUBLE PRECISION,
    "spendProfile" TEXT NOT NULL DEFAULT 'SCURVE',
    "mezzToPct" DOUBLE PRECISION,
    "mezzRatePct" DOUBLE PRECISION,
    "siteMode" TEXT NOT NULL DEFAULT 'RESIDUAL',
    "landFixed" BIGINT NOT NULL DEFAULT 0,
    "acqPct" DOUBLE PRECISION NOT NULL DEFAULT 6.8,
    "agentPct" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "legalPct" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "targetProfitOnGdvPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "jvGpCoinvestPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "jvPrefPct" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "jvPromotePct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "planningStatus" TEXT,
    "cilPerSqm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "s106" BIGINT NOT NULL DEFAULT 0,
    "planningRisk" INTEGER,
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "phases" TEXT,
    "dcf" TEXT,
    "income" TEXT,
    "resultCache" TEXT,
    "narrative" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appraisal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comparable" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "meta" TEXT NOT NULL DEFAULT '',
    "basePsf" DOUBLE PRECISION NOT NULL,
    "adjSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjCondition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjDate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjLocation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "Comparable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descriptor" TEXT NOT NULL DEFAULT '',
    "blendedPsf" DOUBLE PRECISION NOT NULL,
    "buildPsf" DOUBLE PRECISION NOT NULL,
    "gia" INTEGER NOT NULL,
    "targetProfitPct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "surveyorId" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "rooms" TEXT NOT NULL,
    "reconciledValue" BIGINT,
    "approachWeights" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "appraisedValue" BIGINT NOT NULL,
    "agreedValue" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "buyerName" TEXT,
    "buyerSolicitor" TEXT,
    "leadSource" TEXT,
    "incentive" TEXT,
    "depositHeld" BIGINT,
    "reservedAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stalled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMilestone" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "date" TIMESTAMP(3),

    CONSTRAINT "SalesMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenancy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "ervPcm" BIGINT NOT NULL,
    "agreedRentPcm" BIGINT,
    "tenantName" TEXT,
    "leadSource" TEXT,
    "incentive" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "appliedAt" TIMESTAMP(3),
    "stalled" BOOLEAN NOT NULL DEFAULT false,
    "arrears" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Tenancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'On site',
    "rating" TEXT NOT NULL DEFAULT '—',
    "nextCert" TEXT NOT NULL DEFAULT '—',
    "retentionRelease" TEXT NOT NULL DEFAULT '50% at PC',
    "timesheetRate" BIGINT,
    "operatives" INTEGER,
    "weeks" TEXT NOT NULL,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostPackage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "budget" BIGINT NOT NULL,
    "committed" BIGINT NOT NULL DEFAULT 0,
    "spent" BIGINT NOT NULL DEFAULT 0,
    "forecast" BIGINT NOT NULL,
    "retentionPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "certificates" INTEGER NOT NULL DEFAULT 0,
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "contractorId" TEXT,

    CONSTRAINT "CostPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePhoto" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "contractorId" TEXT,
    "url" TEXT NOT NULL DEFAULT '',
    "takenAt" TIMESTAMP(3) NOT NULL,
    "weekCommencing" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SitePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "extraction" TEXT NOT NULL DEFAULT 'STORED',
    "buyerVisible" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3),
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "aiPolicy" TEXT NOT NULL DEFAULT '',
    "toePurpose" TEXT NOT NULL DEFAULT '',
    "toeOtherUsers" TEXT NOT NULL DEFAULT '',
    "toeInterest" TEXT NOT NULL DEFAULT '',
    "toeExtentOfInvestigation" TEXT NOT NULL DEFAULT '',
    "toeSourcesOfInformation" TEXT NOT NULL DEFAULT '',
    "toeAssumptions" TEXT NOT NULL DEFAULT '',
    "toeSpecialAssumptions" TEXT NOT NULL DEFAULT '',
    "toeReportFormat" TEXT NOT NULL DEFAULT '',
    "toeRestrictionsOnUse" TEXT NOT NULL DEFAULT '',
    "toeFeeBasis" TEXT NOT NULL DEFAULT '',
    "toeComplaintsProcedure" TEXT NOT NULL DEFAULT '',
    "toeValuerReg" TEXT NOT NULL DEFAULT '',
    "toeLiabilityCap" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementTerms" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "clientName" TEXT NOT NULL,
    "clientAddress" TEXT NOT NULL DEFAULT '',
    "otherUsers" TEXT NOT NULL DEFAULT 'None. This report is for the addressee client only.',
    "purpose" TEXT NOT NULL,
    "interest" TEXT NOT NULL,
    "basisOfValue" TEXT NOT NULL,
    "valuationDate" TIMESTAMP(3),
    "extentOfInvestigation" TEXT NOT NULL,
    "sourcesOfInformation" TEXT NOT NULL,
    "assumptions" TEXT NOT NULL,
    "specialAssumptions" TEXT NOT NULL,
    "reportFormat" TEXT NOT NULL,
    "restrictionsOnUse" TEXT NOT NULL,
    "feeBasis" TEXT NOT NULL,
    "liabilityCap" BIGINT,
    "complaintsProcedure" TEXT NOT NULL,
    "aiUse" TEXT NOT NULL,
    "valuerName" TEXT NOT NULL,
    "valuerReg" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "signToken" TEXT,
    "signTokenExpiresAt" TIMESTAMP(3),
    "signedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngagementTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "aspect" TEXT NOT NULL,
    "assignee" TEXT NOT NULL DEFAULT 'AO',
    "due" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investor" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL DEFAULT 'IN',
    "contactFirst" TEXT NOT NULL DEFAULT '',
    "sharePct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "documents" TEXT NOT NULL,

    CONSTRAINT "Investor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "sharePct" DOUBLE PRECISION NOT NULL,
    "committed" BIGINT NOT NULL,
    "called" BIGINT NOT NULL DEFAULT 0,
    "distributed" BIGINT NOT NULL DEFAULT 0,
    "irr" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cashflow" (
    "id" TEXT NOT NULL,
    "investorId" TEXT NOT NULL,
    "dealId" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "amount" BIGINT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cashflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripeIntentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkPoint" (
    "id" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "useClass" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL,
    "isOwn" BOOLEAN NOT NULL DEFAULT false,
    "orgId" TEXT,
    "dealName" TEXT,

    CONSTRAINT "BenchmarkPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "lastSync" TIMESTAMP(3),
    "config" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Deal_orgId_stage_idx" ON "Deal"("orgId", "stage");

-- CreateIndex
CREATE INDEX "Appraisal_dealId_isCurrent_idx" ON "Appraisal"("dealId", "isCurrent");

-- CreateIndex
CREATE INDEX "Comparable_dealId_idx" ON "Comparable"("dealId");

-- CreateIndex
CREATE INDEX "Scenario_dealId_idx" ON "Scenario"("dealId");

-- CreateIndex
CREATE INDEX "Inspection_dealId_idx" ON "Inspection"("dealId");

-- CreateIndex
CREATE INDEX "Unit_dealId_status_idx" ON "Unit"("dealId", "status");

-- CreateIndex
CREATE INDEX "Tenancy_dealId_status_idx" ON "Tenancy"("dealId", "status");

-- CreateIndex
CREATE INDEX "CostPackage_dealId_idx" ON "CostPackage"("dealId");

-- CreateIndex
CREATE INDEX "SitePhoto_dealId_weekCommencing_idx" ON "SitePhoto"("dealId", "weekCommencing");

-- CreateIndex
CREATE INDEX "Document_dealId_category_idx" ON "Document"("dealId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPolicy_orgId_key" ON "OrgPolicy"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementTerms_dealId_key" ON "EngagementTerms"("dealId");

-- CreateIndex
CREATE INDEX "EngagementTerms_orgId_status_idx" ON "EngagementTerms"("orgId", "status");

-- CreateIndex
CREATE INDEX "EngagementTerms_signToken_idx" ON "EngagementTerms"("signToken");

-- CreateIndex
CREATE INDEX "ActivityEvent_dealId_at_idx" ON "ActivityEvent"("dealId", "at");

-- CreateIndex
CREATE INDEX "Task_orgId_dealId_done_idx" ON "Task"("orgId", "dealId", "done");

-- CreateIndex
CREATE INDEX "Payment_unitId_status_idx" ON "Payment"("unitId", "status");

-- CreateIndex
CREATE INDEX "BenchmarkPoint_region_useClass_metric_idx" ON "BenchmarkPoint"("region", "useClass", "metric");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appraisal" ADD CONSTRAINT "Appraisal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comparable" ADD CONSTRAINT "Comparable_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMilestone" ADD CONSTRAINT "SalesMilestone_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostPackage" ADD CONSTRAINT "CostPackage_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostPackage" ADD CONSTRAINT "CostPackage_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementTerms" ADD CONSTRAINT "EngagementTerms_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investor" ADD CONSTRAINT "Investor_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cashflow" ADD CONSTRAINT "Cashflow_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "Investor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

