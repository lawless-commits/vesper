# Vesper
Rust (axum + sqlx/Postgres + maud) single-binary app. Local-first AI companion studio.
Pages are server-rendered; static/app.js adds interactivity via data-* attributes.

## Commands
- cargo run / cargo test / cargo clippy
- VESPER_TEST_DATABASE_URL=... cargo test (includes the autopilot concurrency tests)
- ./scripts/build-css.sh after changing Tailwind classes (static/app.css is committed)
- ./e2e/run.sh for the full browser check (heavy: prefer `gh offload -- ./e2e/run.sh`)

## Rules
- Keep the user's laptop light: prefer `gh offload -- <command>` for release builds,
  e2e and anything with Docker or a browser; locally use debug builds with `-j 2`.
- After every change run: cargo test && cargo clippy. Report results.
- API routes return JSON `{ error }` with 400 for bad input, 404 for missing rows, never 500 for user input.
- Never send secrets (api_key) to the client: RuntimeConfig is server-only, RuntimeView is client-safe.
- Schema changes go in a new file under migrations/, never by editing an applied one.
- SQL strings must be `&'static str` (sqlx 0.9); use `crate::bot_columns!()` with `concat!`.
- Ask before adding a dependency.
