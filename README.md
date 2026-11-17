# Vesper

A local companion studio. Build persona bots, chat with them, and let them act
on a schedule ("autopilot"). Vesper is a single Rust binary (axum + Postgres via
sqlx) that renders every page on the server. Replies come from a built-in
offline engine, or from a model you run yourself through Ollama or any
OpenAI-compatible server (LM Studio, llama.cpp, vLLM).

Vesper is a **single-user app for your own machine**. It has no accounts and is
not built to be exposed to the internet. See [Running safely](#running-safely).

## Setup

You need [Rust](https://rustup.rs) 1.88 or newer and a Postgres database (14+).

1. **Get the code.**

   ```sh
   git clone https://github.com/lawless-commits/vesper.git && cd vesper
   ```

2. **Start Postgres.** With Docker:

   ```sh
   docker run --name vesper-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_db \
     -p 127.0.0.1:5432:5432 -d postgres:16
   ```

3. **Create your environment file.**

   ```sh
   cp .env.example .env.local
   ```

   The default `DATABASE_URL` matches the Docker command above.

4. **Run it.**

   ```sh
   cargo run --release
   ```

   The first build takes a few minutes. Tables are created automatically on
   start-up, and six demo bots with a few sample chats appear on first load.

5. **Open <http://127.0.0.1:3000>.** Everything works straight away with the
   built-in engine; connect a real model on the **Runtime** page.

The release binary is `target/release/vesper`. It contains the pages, the
stylesheet and the script, so you can copy it anywhere and run it with a
`DATABASE_URL`.

## Environment variables

Set these in `.env.local` (or the real environment). Only `DATABASE_URL` is required.

| Variable          | Required | What it does |
| ----------------- | -------- | ------------ |
| `DATABASE_URL`    | yes      | Postgres connection string. |
| `AUTOPILOT_TOKEN` | no       | When set, `POST /api/automation/run` only accepts requests from the app's own pages or requests carrying this value in an `x-autopilot-token` header. Set it if you run autopilot from cron. |
| `LLM_API_KEY`     | no       | API key for your model server. Overrides any key saved on the Runtime page, so nothing has to be stored in the database. |
| `VESPER_PASSWORD` | no       | When set, every page and API route except `/api/health` requires HTTP Basic auth with this password (any username). |
| `HOST`, `PORT`    | no       | Where to listen. Defaults to `127.0.0.1` and `3000`. |
| `RUST_LOG`        | no       | Log level, e.g. `vesper=debug`. |

## Commands

| Command | What it does |
| ------- | ------------ |
| `cargo run` | Build and run a debug build (faster to compile, slower to run). |
| `cargo run --release` | Build and run an optimised build. |
| `cargo test` | Unit tests. |
| `cargo clippy` | Lints. |
| `cargo run --release --bin seed_load` | Add 200 conversations / 50,000 messages and time the chat list (`-- --clean` removes them, `-- --time` only times). Needs Vesper running. |
| `./scripts/build-css.sh` | Rebuild `static/app.css` after changing class names. Needs Node (or the standalone Tailwind CLI). |
| `./e2e/run.sh` | Full browser check: Postgres in Docker, a mock model server, headless Chromium. Needs Docker, Rust and Node. |

### Tests that need a database

`cargo test` skips the autopilot concurrency tests unless you point it at a
Postgres database. They create their own bots and remove them afterwards:

```sh
VESPER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db cargo test
```

### Running heavy checks on GitHub instead of your machine

With [gh-offload](https://github.com/lawless-commits/gh-offload) installed, the
same commands run on a GitHub Actions runner using your working tree as it is:

```sh
gh offload -- cargo test
gh offload --get 'e2e/shots/**' -- ./e2e/run.sh
```

### Changing the schema

Add a new file to `migrations/` (for example `0002_add_bot_memories.sql`). It
runs automatically, once, the next time Vesper starts. Never edit a migration
that has already run; add another one.

### Upgrading from the Next.js version

The first migration only creates what is missing, so a database created by the
earlier Next.js version of Vesper (with `npm run db:migrate` or `db:push`)
upgrades in place and keeps its bots and chats. Point `DATABASE_URL` at it and
start Vesper.

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

- **It listens on 127.0.0.1 only** unless you set `HOST`. Setting
  `HOST=0.0.0.0` exposes your bots, chats and settings to everyone on that
  network.
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
src/main.rs          server start-up and routes
src/pages.rs         HTML pages (maud)
src/views.rs         shared page chrome and components
src/api.rs           JSON API under /api
src/data.rs          bots, conversations, messages, runtime settings
src/runtime.rs       model calls and streaming
src/autopilot.rs     scheduler, atomic slot claim, model-written actions
src/persona.rs       built-in reply engine and system prompt
src/avatar.rs        generated emblem avatars (GET /avatar.svg)
src/http.rs          errors, body parsing, same-origin check, password gate
src/bin/seed_load.rs load-test tool
migrations/          SQL, applied on start-up
static/              app.js, compiled app.css, icon (embedded in the binary)
styles/app.css       Tailwind input for static/app.css
e2e/                 browser check and mock model server
tests/fixtures/      replies recorded from the original TypeScript engine
```

## License

MIT. See [LICENSE](LICENSE).
