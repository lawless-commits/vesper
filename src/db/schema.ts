import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const bots = pgTable("bots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  handle: text("handle").notNull().unique(),
  tagline: text("tagline").notNull().default(""),
  bio: text("bio").notNull().default(""),
  persona: text("persona").notNull().default(""),
  greeting: text("greeting").notNull().default(""),
  starters: jsonb("starters").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  avatarUrl: text("avatar_url"),
  avatarSeed: text("avatar_seed").notNull().default("vesper"),
  accent: text("accent").notNull().default("#c9f954"),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  warmth: integer("warmth").notNull().default(60),
  chaos: integer("chaos").notNull().default(35),
  wit: integer("wit").notNull().default(65),
  model: text("model").notNull().default("local"),
  temperature: real("temperature").notNull().default(0.8),
  visibility: text("visibility").notNull().default("public"),
  creator: text("creator").notNull().default("you"),
  featured: boolean("featured").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    botId: integer("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // A bot's threads, newest first.
  (table) => [index("conversations_bot_id_updated_at_idx").on(table.botId, table.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    engine: text("engine").notNull().default("vesper-local"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Transcript reads, per-conversation counts and "latest message" lookups.
  (table) => [
    index("messages_conversation_id_id_idx").on(table.conversationId, table.id),
    check("messages_role_check", sql`${table.role} in ('user', 'assistant')`),
  ],
);

export const runtimeSettings = pgTable("runtime_settings", {
  id: integer("id").primaryKey().default(1),
  provider: text("provider").notNull().default("demo"),
  baseUrl: text("base_url").notNull().default("http://127.0.0.1:11434/v1"),
  model: text("model").notNull().default("llama3.2"),
  apiKey: text("api_key").notNull().default(""),
  temperature: real("temperature").notNull().default(0.8),
  userName: text("user_name").notNull().default("You"),
  // IANA timezone used for autopilot quiet hours and the daily cap window.
  timezone: text("timezone").notNull().default("UTC"),
  // How long to wait for the model, and how long a reply may be.
  timeoutSeconds: integer("timeout_seconds").notNull().default(90),
  maxTokens: integer("max_tokens").notNull().default(600),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const botAutomations = pgTable("bot_automations", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id")
    .notNull()
    .unique()
    .references(() => bots.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  cadenceMinutes: integer("cadence_minutes").notNull().default(60),
  actions: jsonb("actions").$type<string[]>().notNull().default(sql`'["journal"]'::jsonb`),
  dailyLimit: integer("daily_limit").notNull().default(6),
  requireApproval: boolean("require_approval").notNull().default(true),
  useModel: boolean("use_model").notNull().default(false),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: serial("id").primaryKey(),
    botId: integer("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("journal"),
    status: text("status").notNull().default("sent"),
    content: text("content").notNull().default(""),
    partnerBotId: integer("partner_bot_id"),
    partnerContent: text("partner_content"),
    conversationId: integer("conversation_id"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // "How many actions has this bot taken today?" (the daily cap).
  (table) => [index("automation_runs_bot_id_created_at_idx").on(table.botId, table.createdAt)],
);

export const automationTasks = pgTable(
  "automation_tasks",
  {
    id: serial("id").primaryKey(),
    botId: integer("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    done: boolean("done").notNull().default(false),
    sourceRunId: integer("source_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The task list: open tasks first, newest first.
  (table) => [index("automation_tasks_done_id_idx").on(table.done, table.id)],
);

export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type RuntimeSettings = typeof runtimeSettings.$inferSelect;
export type BotAutomation = typeof botAutomations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type AutomationTask = typeof automationTasks.$inferSelect;
