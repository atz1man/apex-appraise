-- AlterTable
ALTER TABLE "ActivityEvent" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "dealId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ActivityEvent_orgId_at_idx" ON "ActivityEvent"("orgId", "at");

