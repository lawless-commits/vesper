-- Vesper schema.
--
-- Every statement is idempotent (IF NOT EXISTS / guarded constraint) so this
-- migration also upgrades databases created by the earlier Next.js version
-- of Vesper (Drizzle migrations or `drizzle-kit push`) without data loss.

CREATE TABLE IF NOT EXISTS bots (
    id serial PRIMARY KEY,
    name text NOT NULL,
    handle text NOT NULL UNIQUE,
    tagline text NOT NULL DEFAULT '',
    bio text NOT NULL DEFAULT '',
    persona text NOT NULL DEFAULT '',
    greeting text NOT NULL DEFAULT '',
    starters jsonb NOT NULL DEFAULT '[]'::jsonb,
    avatar_url text,
    avatar_seed text NOT NULL DEFAULT 'vesper',
    accent text NOT NULL DEFAULT '#c9f954',
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    warmth integer NOT NULL DEFAULT 60,
    chaos integer NOT NULL DEFAULT 35,
    wit integer NOT NULL DEFAULT 65,
    model text NOT NULL DEFAULT 'local',
    temperature real NOT NULL DEFAULT 0.8,
    visibility text NOT NULL DEFAULT 'public',
    creator text NOT NULL DEFAULT 'you',
    featured boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
    id serial PRIMARY KEY,
    bot_id integer NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT 'New chat',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- A bot's threads, newest first.
CREATE INDEX IF NOT EXISTS conversations_bot_id_updated_at_idx ON conversations (bot_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
    id serial PRIMARY KEY,
    conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role text NOT NULL,
    content text NOT NULL,
    engine text NOT NULL DEFAULT 'vesper-local',
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE messages ALTER COLUMN engine SET DEFAULT 'vesper-local';
-- Transcript reads, per-conversation counts and "latest message" lookups.
CREATE INDEX IF NOT EXISTS messages_conversation_id_id_idx ON messages (conversation_id, id);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_role_check') THEN
        ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS runtime_settings (
    id integer PRIMARY KEY DEFAULT 1,
    provider text NOT NULL DEFAULT 'demo',
    base_url text NOT NULL DEFAULT 'http://127.0.0.1:11434/v1',
    model text NOT NULL DEFAULT 'llama3.2',
    api_key text NOT NULL DEFAULT '',
    temperature real NOT NULL DEFAULT 0.8,
    user_name text NOT NULL DEFAULT 'You',
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- IANA timezone used for autopilot quiet hours and the daily cap window.
ALTER TABLE runtime_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
-- How long to wait for the model, and how long a reply may be.
ALTER TABLE runtime_settings ADD COLUMN IF NOT EXISTS timeout_seconds integer NOT NULL DEFAULT 90;
ALTER TABLE runtime_settings ADD COLUMN IF NOT EXISTS max_tokens integer NOT NULL DEFAULT 600;

CREATE TABLE IF NOT EXISTS bot_automations (
    id serial PRIMARY KEY,
    bot_id integer NOT NULL UNIQUE REFERENCES bots(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    cadence_minutes integer NOT NULL DEFAULT 60,
    actions jsonb NOT NULL DEFAULT '["journal"]'::jsonb,
    daily_limit integer NOT NULL DEFAULT 6,
    require_approval boolean NOT NULL DEFAULT true,
    use_model boolean NOT NULL DEFAULT false,
    last_run_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_runs (
    id serial PRIMARY KEY,
    bot_id integer NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    kind text NOT NULL DEFAULT 'journal',
    status text NOT NULL DEFAULT 'sent',
    content text NOT NULL DEFAULT '',
    partner_bot_id integer,
    partner_content text,
    conversation_id integer,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- "How many actions has this bot taken today?" (the daily cap).
CREATE INDEX IF NOT EXISTS automation_runs_bot_id_created_at_idx ON automation_runs (bot_id, created_at);

CREATE TABLE IF NOT EXISTS automation_tasks (
    id serial PRIMARY KEY,
    bot_id integer NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    title text NOT NULL,
    detail text NOT NULL DEFAULT '',
    done boolean NOT NULL DEFAULT false,
    source_run_id integer,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- The task list: open tasks first, newest first.
CREATE INDEX IF NOT EXISTS automation_tasks_done_id_idx ON automation_tasks (done, id);
