-- Break-glass codes: the way back into a workspace whose identity provider has
-- stopped letting anyone in.
--
-- `SsoConnection.enforced` refuses every password in the workspace, and turning
-- it off needs an admin who can sign in — which by then means only through the
-- provider. A changed issuer, an expired signing certificate or an outage locked
-- a firm out of its own records with no remedy but a platform operator editing
-- the column. These are single-use codes, stored only as SHA-256 digests.
CREATE TABLE "SsoRecoveryCode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- a digest is the identity of a code; two rows carrying the same one would be
-- one code that stops working the first time either is spent
CREATE UNIQUE INDEX "SsoRecoveryCode_codeHash_key" ON "SsoRecoveryCode"("codeHash");

CREATE INDEX "SsoRecoveryCode_orgId_idx" ON "SsoRecoveryCode"("orgId");
