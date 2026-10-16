ALTER TABLE "project_runs" ALTER COLUMN "status" SET DEFAULT 'None';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'None';--> statement-breakpoint
ALTER TABLE "agent_jobs" ALTER COLUMN "status" SET DEFAULT 'Queued';