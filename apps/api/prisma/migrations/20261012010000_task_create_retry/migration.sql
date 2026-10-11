ALTER TABLE "Task" ADD COLUMN "createRequestId" TEXT;
ALTER TABLE "Task" ADD COLUMN "createRequest" TEXT;
CREATE UNIQUE INDEX "Task_orgId_createRequestId_key" ON "Task"("orgId", "createRequestId");
