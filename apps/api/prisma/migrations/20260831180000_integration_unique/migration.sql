-- One IntegrationConnection row per provider per workspace.
--
-- `integrations.list` is a QUERY and it backfilled a placeholder row for every
-- self-serve provider the workspace had none for. With no unique key,
-- concurrent reads each saw the row missing and each created it — measured
-- against the real router, three parallel calls left two Companies House rows,
-- and a single call as a VIEWER created two rows.
--
-- Duplicates matter here rather than merely being untidy: `getIntegrationCreds`
-- and `integrations.saveCredentials` both resolve a provider with `findFirst`,
-- so a key saved onto one row can be read from the other — the integration then
-- reports itself unconfigured with the customer's key sitting in the table.
--
-- Existing duplicates are collapsed BEFORE the index is added, or this migration
-- would fail to apply on any deployment that already accumulated them — which is
-- every deployment that has run the old query concurrently. The row kept is the
-- one carrying credentials, then the one that is CONNECTED, then the oldest, so
-- collapsing can never discard a stored key in favour of an empty row.
DELETE FROM "IntegrationConnection" a
USING "IntegrationConnection" b
WHERE a."orgId" = b."orgId"
  AND a."provider" = b."provider"
  AND a."id" <> b."id"
  AND (
    (a."config" = '{}' AND b."config" <> '{}')
    OR (a."config" = b."config" AND a."status" <> 'CONNECTED' AND b."status" = 'CONNECTED')
    OR (a."config" = b."config" AND a."status" = b."status" AND a."id" > b."id")
  );

CREATE UNIQUE INDEX "IntegrationConnection_orgId_provider_key"
  ON "IntegrationConnection"("orgId", "provider");
