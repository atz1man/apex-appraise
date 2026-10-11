CREATE TABLE "UploadErasure" (
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UploadErasure_pkey" PRIMARY KEY ("url")
);
CREATE INDEX "UploadErasure_nextAttemptAt_idx" ON "UploadErasure"("nextAttemptAt");
