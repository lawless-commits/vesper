CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_id" integer NOT NULL,
	"kind" text DEFAULT 'journal' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"partner_bot_id" integer,
	"partner_content" text,
	"conversation_id" integer,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_id" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"source_run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"cadence_minutes" integer DEFAULT 60 NOT NULL,
	"actions" jsonb DEFAULT '["journal"]'::jsonb NOT NULL,
	"daily_limit" integer DEFAULT 6 NOT NULL,
	"require_approval" boolean DEFAULT true NOT NULL,
	"use_model" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_automations_bot_id_unique" UNIQUE("bot_id")
);
--> statement-breakpoint
CREATE TABLE "bots" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"persona" text DEFAULT '' NOT NULL,
	"greeting" text DEFAULT '' NOT NULL,
	"starters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_url" text,
	"avatar_seed" text DEFAULT 'vesper' NOT NULL,
	"accent" text DEFAULT '#c9f954' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warmth" integer DEFAULT 60 NOT NULL,
	"chaos" integer DEFAULT 35 NOT NULL,
	"wit" integer DEFAULT 65 NOT NULL,
	"model" text DEFAULT 'local' NOT NULL,
	"temperature" real DEFAULT 0.8 NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"creator" text DEFAULT 'you' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bots_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot_id" integer NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"engine" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" text DEFAULT 'demo' NOT NULL,
	"base_url" text DEFAULT 'http://127.0.0.1:11434/v1' NOT NULL,
	"model" text DEFAULT 'llama3.2' NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"temperature" real DEFAULT 0.8 NOT NULL,
	"user_name" text DEFAULT 'You' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_automations" ADD CONSTRAINT "bot_automations_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_bot_id_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_bot_id_created_at_idx" ON "automation_runs" USING btree ("bot_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_tasks_done_id_idx" ON "automation_tasks" USING btree ("done","id");--> statement-breakpoint
CREATE INDEX "conversations_bot_id_updated_at_idx" ON "conversations" USING btree ("bot_id","updated_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_id_idx" ON "messages" USING btree ("conversation_id","id");