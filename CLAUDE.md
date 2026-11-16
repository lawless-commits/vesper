# Vesper
Next.js 16 (App Router) + Postgres via Drizzle. Local-first AI companion app.

## Commands
- npm run dev / build / typecheck / lint / test
- npx drizzle-kit push (dev schema sync)

## Rules
- One roadmap item per branch and per commit. Do not touch unrelated files.
- After every change run: npm run typecheck && npm run lint && npm test. Report results.
- API routes return JSON `{ error }` with 400 for bad input, 404 for missing rows, never 500 for user input.
- Never send secrets (apiKey) to the client. Server-only code lives in src/lib and src/db.
- Schema changes go through a Drizzle migration, not ad-hoc SQL.
- Prefer small helpers over duplicated validation; shared helpers live in src/lib/http.ts.
- Ask before adding a dependency.
