/**
 * Load-test helper for the chat list (roadmap item 2.1).
 *
 *   node scripts/seed-load.ts            seed 200 conversations / 50,000 messages, then time the list
 *   node scripts/seed-load.ts --time     only time the list (no seeding)
 *   node scripts/seed-load.ts --clean    remove everything this script created
 *
 * Reads DATABASE_URL from .env.local. Timing calls GET /api/conversations on
 * a running app (VESPER_URL, default http://127.0.0.1:3000), which executes
 * the same listConversations() the /chats page uses. Run it against
 * `npm run build && npm start` for realistic numbers; dev mode is slower.
 *
 * All seeded rows hang off one bot with the handle "load-test", so --clean
 * removes them with a single cascading delete.
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const CONVERSATIONS = 200;
const MESSAGES = 50_000;
const HANDLE = "load-test";
const appUrl = (process.env.VESPER_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const args = new Set(process.argv.slice(2));

async function timeList() {
  const samples: number[] = [];
  let count = 0;
  try {
    for (let i = 0; i < 6; i += 1) {
      const started = performance.now();
      const response = await fetch(`${appUrl}/api/conversations`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { conversations: unknown[] };
      count = data.conversations.length;
      // The first request pays for compilation and connection setup.
      if (i > 0) samples.push(performance.now() - started);
    }
  } catch (error) {
    console.log(`Could not time ${appUrl}/api/conversations (${error instanceof Error ? error.message : error}).`);
    console.log("Start the app, or set VESPER_URL, then run: node scripts/seed-load.ts --time");
    return;
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(
    `listConversations via ${appUrl}: ${count} conversations, ` +
      `median ${median.toFixed(0)} ms, min ${samples[0].toFixed(0)} ms, max ${samples.at(-1)!.toFixed(0)} ms (5 warm runs)`,
  );
}

async function main() {
  if (args.has("--time")) return timeList();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("DELETE FROM bots WHERE handle = $1", [HANDLE]);
    if (args.has("--clean")) {
      console.log("Removed load-test data.");
      return;
    }

    const bot = await client.query<{ id: number }>(
      "INSERT INTO bots (name, handle, tagline, visibility) VALUES ('Load Test', $1, 'Seeded by scripts/seed-load.ts', 'private') RETURNING id",
      [HANDLE],
    );
    const botId = bot.rows[0].id;

    await client.query(
      `INSERT INTO conversations (bot_id, title, updated_at)
       SELECT $1, 'Load test thread ' || n, now() - (n || ' minutes')::interval
       FROM generate_series(1, $2::int) AS n`,
      [botId, CONVERSATIONS],
    );
    // Spread messages evenly: each conversation gets MESSAGES / CONVERSATIONS turns.
    await client.query(
      `INSERT INTO messages (conversation_id, role, content, engine, created_at)
       SELECT c.id,
              CASE WHEN m % 2 = 0 THEN 'assistant' ELSE 'user' END,
              'Load test message ' || m || ' — ' || repeat('lorem ipsum dolor sit amet ', 8),
              CASE WHEN m % 2 = 0 THEN 'vesper-local' ELSE 'user' END,
              now() - ((($3::int / $2::int) - m) || ' seconds')::interval
       FROM (SELECT id FROM conversations WHERE bot_id = $1) AS c
       CROSS JOIN generate_series(1, $3::int / $2::int) AS m`,
      [botId, CONVERSATIONS, MESSAGES],
    );
    const total = await client.query<{ count: string }>("SELECT count(*) FROM messages");
    console.log(`Seeded ${CONVERSATIONS} conversations and ${MESSAGES} messages (messages table now has ${total.rows[0].count} rows).`);
  } finally {
    await client.end();
  }
  await timeList();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
