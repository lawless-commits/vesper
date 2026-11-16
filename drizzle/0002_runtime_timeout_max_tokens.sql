ALTER TABLE "runtime_settings" ADD COLUMN "timeout_seconds" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_settings" ADD COLUMN "max_tokens" integer DEFAULT 600 NOT NULL;