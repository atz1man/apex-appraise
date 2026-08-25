-- upsertUnit and upsertTenancy each write every field of a record from one
-- drawer: name, spec, agreed value or rent, buyer or tenant, solicitor,
-- incentive, progress. Two agents in a sales office on the same plot — one
-- recording the solicitor, the other the agreed value — and one of them loses,
-- silently, on a figure that reaches a contract.
--
-- Both tables, not just the one that prompted this: they are the same drawer on
-- the same screen, and half a guard is the half somebody relies on.
--
-- DEFAULT CURRENT_TIMESTAMP so existing rows get a value and this cannot block
-- on real data; CURRENT_TIMESTAMP rather than NOW() because the same SQL has to
-- run on SQLite in development (docs/DATABASE.md).
ALTER TABLE "Unit" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Tenancy" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
