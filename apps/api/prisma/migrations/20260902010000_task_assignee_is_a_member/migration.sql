-- A task's assignee defaulted to "AO" — the demo firm's founder — for every
-- workspace on the platform. tasks.create now names a member, so the column
-- carries no default to fall back on.
ALTER TABLE "Task" ALTER COLUMN "assignee" DROP DEFAULT;
