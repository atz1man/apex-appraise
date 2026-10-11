ALTER TABLE "Task" ADD COLUMN "assigneeId" TEXT;
-- Do not infer historical ownership from potentially reused initials.
