# Vesper

A local companion studio. Build persona bots, chat with them, and let them act
on a schedule ("autopilot"). Vesper is a Next.js 16 app backed by Postgres
(Drizzle ORM). Replies come from a built-in offline engine, or from a model you
run yourself through Ollama or any OpenAI-compatible server (LM Studio,
llama.cpp, vLLM).

Vesper is a **single-user app for your own machine**. It has no accounts and is
not built to be exposed to the internet. See [Running safely](#running-safely).

## Setup

You need Node.js 20.9 or newer and a Postgres database.

1. **Get the code and install dependencies.**

   ```sh
   git clone <your-repo-url> vesper && cd vesper
   npm install
   ```

2. **Start Postgres.** Any Postgres 14+ works. With Docker:

   ```sh
   docker run --name vesper-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_db \
     -p 127.0.0.1:5432:5432 -d postgres:16
   ```

3. **Create your environment file.**

   ```sh
   cp .env.example .env.local
   ```

   The default `DATABASE_URL` matches the Docker command above. Edit it if your
   database lives elsewhere.

4. **Create the tables.**

   ```sh
   npm run db:migrate
   ```

5. **Run the app.**

   ```sh
   npm run dev
   ```

   Open <http://127.0.0.1:3000>. Six demo bots and a few sample chats are
   created on first load. Everything works immediately with the built-in
   engine; connect a real model on the **Runtime** page.

## Environment variables

Set these in `.env.local`. Only `DATABASE_URL` is required.

| Variable          | Required | What it does |
| ----------------- | -------- | ------------ |
| `DATABASE_URL`    | yes      | Postgres connection string, used by the app and by drizzle-kit. |
| `AUTOPILOT_TOKEN` | no       | When set, `POST /api/automation/run` only accepts requests from the app's own pages or requests carrying this value in an `x-autopilot-token` header. Set it if you run autopilot from cron. |
| `LLM_API_KEY`     | no       | API key for your model server. Overrides any key saved on the Runtime page, so nothing has to be stored in the database. |
| `VESPER_PASSWORD` | no       | When set, every page and API route except `/api/health` requires HTTP Basic auth with this password (any username). |

## Scripts

| Command               | What it does |
| --------------------- | ------------ |
| `npm run dev`         | Development server on `127.0.0.1:3000`. |
| `npm run build`       | Production build. |
| `npm start`           | Serve the production build on `127.0.0.1:3000`. |
| `npm run typecheck`   | TypeScript check, no output files. |
| `npm run lint`        | ESLint. |
| `npm test`            | Unit tests (Vitest). |
| `npm run db:migrate`  | Apply the SQL migrations in `drizzle/` to the database. |
| `npm run db:generate` | After editing `src/db/schema.ts`, write a new migration file. |
| `npm run db:push`     | Sync the schema straight to the database without a migration file. |

To pass options through, add `--`: for example `npm run dev -- -p 4000`.

### Changing the schema

Edit `src/db/schema.ts`, run `npm run db:generate`, review the new file in
`drizzle/`, then run `npm run db:migrate`. Commit the migration with the code.

### If your database was created with `drizzle-kit push`

Earlier versions of this project had no migrations and used
`npx drizzle-kit push`. Such a database has the tables but no migration
history, so `npm run db:migrate` would try to create tables that already exist
and fail. Choose one:

- **Keep using push**: run `npm run db:push` whenever the schema changes.
- **Start again with migrations**: drop and re-create the database, then run
  `npm run db:migrate`. This deletes your bots and chats.

### Tests that need a database

`npm test` skips the autopilot concurrency test unless you point it at a
migrated database. It creates its own bots and removes them afterwards:

```sh
VESPER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db npm test
```

`node scripts/seed-load.ts` fills the database with 200 conversations and
50,000 messages and times the chat list; `node scripts/seed-load.ts --clean`
removes them again.

## Connecting a model

Open **Runtime** and pick a provider:

- **Built-in engine**: no model, no setup. Replies are composed from each
  bot's persona and dials. Good for trying the app; it does not reason.
- **Ollama**: install Ollama, `ollama pull llama3.2`, and use
  `http://127.0.0.1:11434`.
- **OpenAI-compatible**: any server with `/v1/chat/completions`, such as
  LM Studio on `http://127.0.0.1:1234/v1`.

Replies stream in token by token, and **Stop** keeps whatever has arrived. If
the model cannot be reached or stays silent longer than the timeout (default
90 seconds, adjustable on the Runtime page), the built-in engine answers
instead and a notice says why.

An API key, if your server needs one, is write-only: once saved it is never
sent back to the browser. Leave the box blank to keep the saved key, or use
**Remove key**. It is stored unencrypted in the `runtime_settings` table; to
avoid storing it at all, set `LLM_API_KEY` instead.

## Autopilot

On the **Autopilot** page each bot can be armed with a cadence, a daily cap and
a set of actions: journal posts, messages to you (which wait for your approval
by default), bot-to-bot relays and tasks. With **Write with my local model**
on, the text comes from your model; otherwise, or if the model fails, it comes
from built-in templates. Each entry in the activity feed is labelled with its
source.

Nothing runs by itself. Something has to call the scheduler:

- **In the browser**: press **Go live** on the Autopilot page. The tab checks
  for due bots every 30 seconds for as long as it stays open.
- **From cron**, for unattended use while the server is running:

  ```cron
  # every 15 minutes
  */15 * * * * curl -s -X POST http://127.0.0.1:3000/api/automation/run -H 'content-type: application/json' -H 'x-autopilot-token: YOUR_TOKEN' -d '{"mode":"tick"}'
  ```

  Leave out the `x-autopilot-token` header if `AUTOPILOT_TOKEN` is not set. If
  `VESPER_PASSWORD` is set, also add `-u vesper:YOUR_PASSWORD`.

Running both at once is safe: each bot's turn is claimed atomically, so two
callers cannot make the same bot act twice.

Quiet hours (01:00 to 07:00) and the daily cap use the timezone set on the
Runtime page, not the server's clock. The default is UTC.

## Running safely

- **It listens on 127.0.0.1 only.** `npm run dev` and `npm start` are not
  reachable from other machines. Changing the host (`-H 0.0.0.0`) exposes your
  bots, chats and settings to everyone on that network.
- **There are no user accounts.** Anyone who can reach the app can read and
  change everything. If you must reach it from another device, set
  `VESPER_PASSWORD` and put it behind HTTPS (a reverse proxy or a tunnel);
  Basic auth sends the password with every request and is only private over
  HTTPS.
- **`AUTOPILOT_TOKEN` is not a login.** It stops other websites and stray
  scripts from triggering autopilot runs. It does not protect any other route.
- **Your model server sees your prompts.** The app sends each bot's persona and
  recent messages to the URL on the Runtime page. With a local server nothing
  leaves your machine; with a hosted endpoint, that provider receives them.
- **Avatar images.** An `https://` avatar URL is fetched by your browser from
  that site. Presets and `data:` images involve no outside request.
- **Secrets live in `.env.local`**, which is git-ignored. Do not commit it.

## Project layout

```
src/app/            pages and API routes (App Router)
src/components/     client components
src/db/             Drizzle schema and connection
src/lib/            server logic: data access, runtime (model calls), autopilot, helpers
src/proxy.ts        optional Basic auth
drizzle/            SQL migrations
scripts/            load-test seeding
tests/              tests that need a database
```

## License

MIT. See [LICENSE](LICENSE).
