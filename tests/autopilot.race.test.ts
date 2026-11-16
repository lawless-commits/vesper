/**
 * Integration test for the autopilot slot claim (roadmap item 1.3).
 *
 * Needs a real Postgres, so it only runs when VESPER_TEST_DATABASE_URL is set:
 *   VESPER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db npm test
 * Use a database whose schema is up to date (npm run db:migrate). The test
 * creates its own bots and deletes them afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.VESPER_TEST_DATABASE_URL;

describe.skipIf(!url)("autopilot slot claim", () => {
  type Autopilot = typeof import("@/lib/autopilot");
  type Db = typeof import("@/db");
  type Schema = typeof import("@/db/schema");
  let autopilot: Autopilot;
  let dbModule: Db;
  let schema: Schema;
  const botIds: number[] = [];

  // Noon UTC today: outside quiet hours for the default UTC timezone.
  const noon = new Date();
  noon.setUTCHours(12, 0, 0, 0);

  async function makeBot(dailyLimit: number) {
    const handle = `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await dbModule.db
      .insert(schema.bots)
      .values({ name: "Race Test", handle, tags: ["testing", "timing"] })
      .returning({ id: schema.bots.id });
    const botId = created[0].id;
    botIds.push(botId);
    await autopilot.ensureAutomations();
    await autopilot.upsertAutomation({
      botId,
      enabled: true,
      cadenceMinutes: 60,
      actions: ["journal"],
      dailyLimit,
    });
    return botId;
  }

  async function runCount(botId: number) {
    const { eq, sql } = await import("drizzle-orm");
    const rows = await dbModule.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.botId, botId));
    return rows[0]?.count ?? 0;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    dbModule = await import("@/db");
    schema = await import("@/db/schema");
    const data = await import("@/lib/data");
    await data.ensureSeeded();
    autopilot = await import("@/lib/autopilot");
    // Open every pooled connection up front. Otherwise the first caller
    // finishes its whole cycle while the other nine are still connecting,
    // and the race this test exists to catch never actually happens.
    const { sql } = await import("drizzle-orm");
    await Promise.all(Array.from({ length: 10 }, () => dbModule.db.execute(sql`select pg_sleep(0.05)`)));
  });

  afterAll(async () => {
    if (!dbModule) return;
    const { inArray } = await import("drizzle-orm");
    if (botIds.length) await dbModule.db.delete(schema.bots).where(inArray(schema.bots.id, botIds));
    await dbModule.pool.end();
  });

  it("10 parallel ticks for one due bot create exactly one run", async () => {
    const botId = await makeBot(6);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => autopilot.runBotCycle({ botId, now: noon })),
    );
    expect(outcomes.filter((outcome) => outcome.status === "sent")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.summary === "Not due yet.")).toHaveLength(9);
    expect(await runCount(botId)).toBe(1);
  });

  it("a second wave inside the cadence window does nothing", async () => {
    const botId = await makeBot(6);
    await autopilot.runBotCycle({ botId, now: noon });
    const later = new Date(noon.getTime() + 59 * 60 * 1000);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => autopilot.runBotCycle({ botId, now: later })),
    );
    expect(outcomes.every((outcome) => outcome.status === "skipped")).toBe(true);
    expect(await runCount(botId)).toBe(1);
  });

  it("the daily limit holds across repeated parallel waves", async () => {
    const botId = await makeBot(3);
    for (let wave = 0; wave < 6; wave += 1) {
      const now = new Date(noon.getTime() + wave * 61 * 60 * 1000);
      await Promise.all(Array.from({ length: 10 }, () => autopilot.runBotCycle({ botId, now })));
    }
    expect(await runCount(botId)).toBe(3);
  });

  it("a forced run ignores the cadence but still stamps lastRunAt", async () => {
    const botId = await makeBot(6);
    await autopilot.runBotCycle({ botId, now: noon });
    const forced = await autopilot.runBotCycle({ botId, now: new Date(noon.getTime() + 60_000), force: true });
    expect(forced.status).toBe("sent");
    const notDue = await autopilot.runBotCycle({ botId, now: new Date(noon.getTime() + 60 * 60 * 1000) });
    expect(notDue.summary).toBe("Not due yet.");
    expect(await runCount(botId)).toBe(2);
  });
});
