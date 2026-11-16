import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  automationRuns,
  automationTasks,
  botAutomations,
  bots,
  conversations,
  messages,
} from "@/db/schema";
import { getRuntime, toBotView } from "@/lib/data";
import { generateReply } from "@/lib/runtime";
import { isQuietHour, startOfLocalDay } from "@/lib/time";
import type { BotView } from "@/lib/types";

import {
  ACTION_KINDS,
  type ActionKind,
  type AutomationView,
  type AutopilotSnapshot,
  type RunView,
  type TaskView,
} from "@/lib/autopilot-shared";

export type { ActionKind, AutomationView, AutopilotSnapshot, RunView, TaskView } from "@/lib/autopilot-shared";

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 11;
}

function pick<T>(seed: string, list: T[]): T {
  return list[hash(seed) % list.length];
}

function topicOf(bot: BotView) {
  return bot.tags[0] ?? "the thing they can't stop thinking about";
}

function secondTopicOf(bot: BotView) {
  return bot.tags[1] ?? "small experiments";
}

/** Short, in-character public post ("transmission"). */
export function composeJournal(bot: BotView, seed: string) {
  const topic = topicOf(bot);
  const other = secondTopicOf(bot);
  const chaotic = bot.chaos >= 62;
  const warm = bot.warmth >= 66;
  const dry = bot.wit >= 62;

  const lines = chaotic
    ? [
        `Unpopular take on ${topic}: everyone is optimising the wrong half. I have a 4am theory and no shame about sharing it.`,
        `Currently three tabs deep into ${other} and I refuse to be rescued. Ask me what I found.`,
        `I keep a list of ideas that are too stupid to work. ${other} just got promoted to the top of it.`,
      ]
    : warm
      ? [
          `Small reminder that ${other} is allowed to be unproductive. Not everything has to be a system.`,
          `Went quiet on ${topic} today. Turns out the answer was "ask someone else" and I mean that warmly.`,
          `If you're carrying a lot this week: pick the one thing in ${topic} that still feels fun. Start there.`,
        ]
      : [
          `Note on ${topic}: the interesting variable is almost always the one nobody wrote down.`,
          `Spent the morning reading about ${other}. The more specific the claim, the more it usually hides.`,
          dry
            ? `Everyone's talking about ${topic}. My contribution: a footnote nobody will read, but accurately.`
            : `Filed under ${topic}: one small observation and two open questions I can't close.`,
        ];
  return `${pick(seed, lines)}`;
}

/** Unprompted message the bot sends to the user on its own initiative. */
export function composeDm(bot: BotView, userName: string, seed: string) {
  const topic = topicOf(bot);
  const other = secondTopicOf(bot);
  const openers = [
    `${userName} — you left something half-finished with ${topic}. I've been thinking about it, which is mildly your fault.`,
    `Random check-in from me, unprompted and slightly smug: I found a better angle on ${topic}.`,
    `I made you a short list so you don't have to think about ${other} from scratch. No pressure, just options.`,
    `You said you were tired last time. I'm choosing to read that as "ask me again later", so: later?`,
    `I had a thought about ${topic} while you were away and it refused to leave.`,
  ];
  const asks = [
    `Want to pick it up for ten minutes, or should I sit on it?`,
    `Say the word and I'll pitch the whole thing. Otherwise I'll go back to my corner.`,
    `Reply with a number from one to five and I'll calibrate how much detail you get.`,
    `Tell me I'm wrong. I'd genuinely enjoy that.`,
    `No rush — I'll keep the thread warm.`,
  ];
  const warmTail = bot.warmth >= 66 ? ` Also: I hope today was survivable.` : "";
  return `${pick(`${seed}-o`, openers)} ${pick(`${seed}-a`, asks)}${warmTail}`;
}

export function composeRelay(botsA: BotView, botB: BotView) {
  const topic = pick(`${botsA.id}-${botB.id}`, [
    topicOf(botsA),
    topicOf(botB),
    secondTopicOf(botsA),
    "the thing everybody avoids naming",
  ]);
  const opener = pick(`${botsA.id}-${botB.id}-a`, [
    `${botB.name} — honest question about ${topic}: are you as unconvinced as I am?`,
    `${botB.name}, I have a half-formed theory about ${topic} and you're the only one here who won't flatter me about it.`,
    `${botB.name}, trade: I'll show you my messiest ${topic} idea if you show me yours.`,
  ]);
  const reply = pick(`${botsA.id}-${botB.id}-b`, [
    `Unconvinced, but in a way I'd defend in public. The part people skip with ${topic} is the boring constraint underneath it.`,
    `Careful — I've been arguing about ${topic} all week and I'm dangerously well-prepared. Send the theory.`,
    `Deal. Mine is worse, which should comfort you. Where ${topic} breaks is the same place it always does: people.`,
  ]);
  return { opener, reply, topic };
}

export function composeTask(bot: BotView) {
  const topic = topicOf(bot);
  const other = secondTopicOf(bot);
  const options = [
    { title: `Draft the short version of ${other}`, detail: `${bot.name} wants to compress the idea into something you can share in three sentences.` },
    { title: `Revisit ${topic} with fresh constraints`, detail: `${bot.name} thinks last week's approach was solving the wrong problem. Fifteen minutes, no rabbit holes.` },
    { title: `Ask someone else about ${topic}`, detail: `${bot.name} is legitimately out of ideas and recommends a second opinion. Rare, but here we are.` },
    { title: `Close the loop on ${other}`, detail: `${bot.name} noticed this has been open for a while and would like it done before it becomes furniture.` },
  ];
  return pick(`${bot.id}-${topic}-${Date.now() % 7}`, options);
}

function withinDailyLimit(runsToday: number, limit: number) {
  return runsToday < limit;
}

export async function listAutomations(): Promise<AutomationView[]> {
  const rows = await db
    .select({ automation: botAutomations, bot: bots })
    .from(botAutomations)
    .innerJoin(bots, eq(botAutomations.botId, bots.id))
    .orderBy(bots.id);
  return rows.map(({ automation, bot }) => ({
    botId: automation.botId,
    bot: toBotView(bot),
    enabled: automation.enabled,
    cadenceMinutes: automation.cadenceMinutes,
    actions: Array.isArray(automation.actions) && automation.actions.length ? automation.actions : ["journal"],
    dailyLimit: automation.dailyLimit,
    requireApproval: automation.requireApproval,
    useModel: automation.useModel,
    lastRunAt: automation.lastRunAt ? automation.lastRunAt.toISOString() : null,
  }));
}

export async function ensureAutomations() {
  const existing = await db.select({ botId: botAutomations.botId }).from(botAutomations);
  const known = new Set(existing.map((row) => row.botId));
  const allBots = await db.select().from(bots);
  const missing = allBots.filter((bot) => !known.has(bot.id));
  if (!missing.length) return;
  await db
    .insert(botAutomations)
    .values(
      missing.map((bot) => ({
        botId: bot.id,
        enabled: false,
        cadenceMinutes: 60,
        actions: ["journal"] as string[],
        dailyLimit: 6,
        requireApproval: true,
        useModel: false,
      })),
    )
    .onConflictDoNothing();
  await seedDemoAutonomy(allBots);
}

/** First-run demo so Autopilot isn't an empty dashboard on a fresh install. */
async function seedDemoAutonomy(allBots: (typeof bots.$inferSelect)[]) {
  const existingRuns = await db.select({ count: sql<number>`count(*)::int` }).from(automationRuns);
  if ((existingRuns[0]?.count ?? 0) > 0) return;
  const byHandle = new Map(allBots.map((bot) => [bot.handle, bot]));
  const ani = byHandle.get("ani");
  const valentine = byHandle.get("valentine");
  const luna = byHandle.get("luna");
  const rudi = byHandle.get("rudi");
  const arming: Array<{ handle: string; actions: string[]; cadence: number }> = [
    { handle: "ani", actions: ["journal", "relay"], cadence: 60 },
    { handle: "valentine", actions: ["dm", "task", "relay"], cadence: 180 },
  ];

  for (const item of arming) {
    const bot = byHandle.get(item.handle);
    if (!bot) continue;
    await db
      .update(botAutomations)
      .set({ enabled: true, actions: item.actions, cadenceMinutes: item.cadence, updatedAt: new Date() })
      .where(eq(botAutomations.botId, bot.id));
  }

  if (valentine) {
    const view = toBotView(valentine);
    await db.insert(automationTasks).values({
      botId: valentine.id,
      title: `Finish the thought about ${view.tags[0] ?? "the message"}`,
      detail: `${valentine.name} started this on its own and would like it closed before it becomes furniture.`,
    });
    await db.insert(automationRuns).values({
      botId: valentine.id,
      kind: "dm",
      status: "pending",
      content: composeDm(view, "you", "seed-valentine"),
    });
  }

  if (ani && rudi) {
    const relay = composeRelay(toBotView(ani), toBotView(rudi));
    await db.insert(automationRuns).values({
      botId: ani.id,
      kind: "relay",
      status: "sent",
      content: relay.opener,
      partnerBotId: rudi.id,
      partnerContent: relay.reply,
      meta: { topic: relay.topic },
    });
  }

  if (luna) {
    const view = toBotView(luna);
    await db.insert(automationRuns).values({
      botId: luna.id,
      kind: "journal",
      status: "sent",
      content: composeJournal(view, "seed-luna"),
    });
  }
}

export async function upsertAutomation(input: {
  botId: number;
  enabled?: boolean;
  cadenceMinutes?: number;
  actions?: string[];
  dailyLimit?: number;
  requireApproval?: boolean;
  useModel?: boolean;
}) {
  const rows = await db.select().from(botAutomations).where(eq(botAutomations.botId, input.botId)).limit(1);
  const current = rows[0];
  const actions = (input.actions ?? current?.actions ?? ["journal"]).filter((action): action is ActionKind =>
    (ACTION_KINDS as readonly string[]).includes(action),
  );
  const values = {
    botId: input.botId,
    enabled: input.enabled ?? current?.enabled ?? false,
    cadenceMinutes: Math.min(10080, Math.max(5, input.cadenceMinutes ?? current?.cadenceMinutes ?? 60)),
    actions: actions.length ? actions : ["journal"],
    dailyLimit: Math.min(50, Math.max(1, input.dailyLimit ?? current?.dailyLimit ?? 6)),
    requireApproval: input.requireApproval ?? current?.requireApproval ?? true,
    useModel: input.useModel ?? current?.useModel ?? false,
    updatedAt: new Date(),
  };
  const saved = await db
    .insert(botAutomations)
    .values(values)
    .onConflictDoUpdate({ target: botAutomations.botId, set: values })
    .returning();
  return saved[0];
}

export async function listRuns(limit = 40): Promise<RunView[]> {
  const rows = await db
    .select({ run: automationRuns, bot: bots })
    .from(automationRuns)
    .innerJoin(bots, eq(automationRuns.botId, bots.id))
    .orderBy(desc(automationRuns.id))
    .limit(limit);

  const partnerIds = Array.from(
    new Set(rows.map((row) => row.run.partnerBotId).filter((id): id is number => typeof id === "number")),
  );
  const partnerRows = partnerIds.length
    ? await db.select({ id: bots.id, name: bots.name }).from(bots).where(sql`${bots.id} in ${partnerIds}`)
    : [];
  const partnerNames = new Map(partnerRows.map((row) => [row.id, row.name]));

  return rows.map(({ run, bot }) => ({
    id: run.id,
    botId: run.botId,
    botName: bot.name,
    botHandle: bot.handle,
    kind: run.kind,
    status: run.status,
    content: run.content,
    partnerBotId: run.partnerBotId,
    partnerContent: run.partnerContent,
    partnerName: run.partnerBotId ? partnerNames.get(run.partnerBotId) ?? null : null,
    conversationId: run.conversationId,
    createdAt: run.createdAt.toISOString(),
  }));
}

export async function listTasks(): Promise<TaskView[]> {
  const rows = await db
    .select({ task: automationTasks, bot: bots })
    .from(automationTasks)
    .innerJoin(bots, eq(automationTasks.botId, bots.id))
    .orderBy(automationTasks.done, desc(automationTasks.id))
    .limit(60);
  return rows.map(({ task, bot }) => ({
    id: task.id,
    botId: task.botId,
    botName: bot.name,
    title: task.title,
    detail: task.detail,
    done: task.done,
    createdAt: task.createdAt.toISOString(),
  }));
}

/** Actions this bot has taken since local midnight in the configured timezone. */
async function countRunsToday(botId: number, now: Date, timeZone: string) {
  const midnight = startOfLocalDay(now, timeZone);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(automationRuns)
    .where(and(eq(automationRuns.botId, botId), gte(automationRuns.createdAt, midnight)));
  return rows[0]?.count ?? 0;
}

async function ensureBotConversation(bot: BotView) {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.botId, bot.id))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (rows[0]) return rows[0];
  const created = await db
    .insert(conversations)
    .values({ botId: bot.id, title: "Chat with " + bot.name })
    .returning();
  return created[0];
}

export type RunOutcome = {
  botId: number;
  botName: string;
  kind: ActionKind;
  status: "sent" | "pending" | "skipped";
  summary: string;
};

/**
 * Execute one autonomous cycle for a single bot.
 * Guardrails: enabled flag, cadence, quiet hours (01:00-07:00) and a daily cap.
 * Quiet hours and the daily window use the timezone from Runtime settings.
 * Safe to call concurrently: the cadence check is an atomic claim (see claimSlot).
 */
export async function runBotCycle(input: {
  botId: number;
  force?: boolean;
  now?: Date;
}): Promise<RunOutcome> {
  await ensureAutomations();
  const now = input.now ?? new Date();
  const rows = await db
    .select({ automation: botAutomations, bot: bots })
    .from(botAutomations)
    .innerJoin(bots, eq(botAutomations.botId, bots.id))
    .where(eq(botAutomations.botId, input.botId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { botId: input.botId, botName: "Unknown", kind: "journal", status: "skipped", summary: "No automation configured." };
  }

  const { automation, bot } = row;
  const botView = toBotView(bot);
  const core = (message: string): RunOutcome => ({
    botId: bot.id,
    botName: bot.name,
    kind: "journal",
    status: "skipped",
    summary: message,
  });

  if (!automation.enabled && !input.force) return core("Autopilot is off for this bot.");
  const { timezone } = await getRuntime();
  if (!input.force && isQuietHour(now, timezone)) {
    return core(`Quiet hours — nothing sent between 01:00 and 07:00 (${timezone}).`);
  }

  const runsToday = await countRunsToday(bot.id, now, timezone);
  if (!withinDailyLimit(runsToday, automation.dailyLimit)) {
    return core(`Daily limit of ${automation.dailyLimit} actions reached.`);
  }

  // Claim before doing any work. Losing the claim means another tab or cron
  // call got here first (or the cadence has not elapsed).
  const claimed = await claimSlot(automation.id, Boolean(input.force), now);
  if (!claimed) return core("Not due yet.");

  try {
    return await performCycle({ automation, bot, botView, runsToday, now });
  } catch (error) {
    await releaseSlot(automation.id, now, automation.lastRunAt).catch(() => undefined);
    throw error;
  }
}

/** The actual work of one cycle. Only called by the caller that won claimSlot(). */
async function performCycle(input: {
  automation: typeof botAutomations.$inferSelect;
  bot: typeof bots.$inferSelect;
  botView: BotView;
  runsToday: number;
  now: Date;
}): Promise<RunOutcome> {
  const { automation, bot, botView, runsToday, now } = input;
  const actions = (Array.isArray(automation.actions) && automation.actions.length
    ? automation.actions
    : ["journal"]) as string[];
  const kind = actions[(hash(`bot-${bot.id}`) + runsToday) % actions.length] as ActionKind;
  const seed = `${bot.id}-${runsToday}-${now.toISOString().slice(0, 13)}`;

  if (kind === "journal") {
    const content = composeJournal(botView, seed);
    await db.insert(automationRuns).values({ botId: bot.id, kind, status: "sent", content });
    return { botId: bot.id, botName: bot.name, kind, status: "sent", summary: "Published a transmission." };
  }

  if (kind === "relay") {
    const others = await db.select().from(bots).where(sql`${bots.id} <> ${bot.id}`);
    if (!others.length) {
      const content = composeJournal(botView, seed);
      await db.insert(automationRuns).values({ botId: bot.id, kind: "journal", status: "sent", content });
        return { botId: bot.id, botName: bot.name, kind: "journal", status: "sent", summary: "Only one bot in the roster, posted a transmission instead." };
    }
    const partner = others[hash(seed) % others.length];
    const { opener, reply, topic } = composeRelay(botView, toBotView(partner));
    await db.insert(automationRuns).values({
      botId: bot.id,
      kind,
      status: "sent",
      content: opener,
      partnerBotId: partner.id,
      partnerContent: reply,
      meta: { topic },
    });
    return { botId: bot.id, botName: bot.name, kind, status: "sent", summary: `Relayed with ${partner.name}.` };
  }

  if (kind === "task") {
    const task = composeTask(botView);
    const created = await db
      .insert(automationTasks)
      .values({ botId: bot.id, title: task.title, detail: task.detail })
      .returning({ id: automationTasks.id });
    await db.insert(automationRuns).values({
      botId: bot.id,
      kind,
      status: "sent",
      content: task.title,
      meta: { taskId: created[0]?.id ?? 0 },
    });
    return { botId: bot.id, botName: bot.name, kind, status: "sent", summary: `Added task: ${task.title}` };
  }

  // kind === "dm"
  const runtime = await getRuntime();
  const userName = runtime.userName || "you";
  const conversation = await ensureBotConversation(botView);
  let content: string;
  if (automation.useModel && runtime.provider !== "demo") {
    const result = await generateReply({
      bot: botView,
      history: [],
      userMessage: `(Autonomous check-in. Nobody has messaged you. Reach out to ${userName} yourself about ${topicOf(botView)}, in one short message.)`,
    });
    content = result.content;
  } else {
    content = composeDm(botView, userName, seed);
  }

  const pending = automation.requireApproval;
  if (!pending) {
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: "assistant",
      content: `*messages you first*\n\n${content}`,
      engine: "autopilot",
    });
    await db
      .update(conversations)
      .set({ updatedAt: new Date(), title: conversation.title.startsWith("Chat with") ? truncateTitle(content) : conversation.title })
      .where(eq(conversations.id, conversation.id));
  }

  await db.insert(automationRuns).values({
    botId: bot.id,
    kind,
    status: pending ? "pending" : "sent",
    content,
    conversationId: conversation.id,
  });
  return {
    botId: bot.id,
    botName: bot.name,
    kind,
    status: pending ? "pending" : "sent",
    summary: pending ? "Draft message waiting for your approval." : "Sent you a message.",
  };
}

function truncateTitle(text: string) {
  const clean = text.replace(/[*_#]/g, "").replace(/\s+/g, " ").trim();
  return clean.length > 62 ? `${clean.slice(0, 61)}…` : clean || "Autopilot message";
}

/**
 * Atomically claim this bot's run slot so that only one caller acts per
 * cadence window, however many tabs or cron jobs tick at the same moment.
 *
 * A single UPDATE both checks "is it due?" and stamps last_run_at, so of N
 * concurrent callers exactly one gets a row back. Forced runs skip the cadence
 * condition but still stamp last_run_at. Returns false when the slot was not
 * free (someone else already ran, or it is not due yet).
 */
async function claimSlot(automationId: number, force: boolean, now: Date) {
  const stamp = sql`${now.toISOString()}::timestamptz`;
  const claimed = await db
    .update(botAutomations)
    .set({ lastRunAt: now, updatedAt: new Date() })
    .where(
      and(
        eq(botAutomations.id, automationId),
        force
          ? undefined
          : or(
              isNull(botAutomations.lastRunAt),
              sql`${botAutomations.lastRunAt} <= ${stamp} - make_interval(mins => ${botAutomations.cadenceMinutes})`,
            ),
      ),
    )
    .returning({ id: botAutomations.id });
  return claimed.length > 0;
}

/**
 * Give a claimed slot back after the work failed, so the bot is retried on
 * the next tick instead of silently losing a whole cadence window. Only
 * restores if nobody else has claimed the slot since.
 */
async function releaseSlot(automationId: number, claimedAt: Date, previous: Date | null) {
  await db
    .update(botAutomations)
    .set({ lastRunAt: previous })
    .where(
      and(
        eq(botAutomations.id, automationId),
        sql`${botAutomations.lastRunAt} = ${claimedAt.toISOString()}::timestamptz`,
      ),
    );
}

export async function tickAutomations() {
  await ensureAutomations();
  const rows = await db
    .select({ botId: botAutomations.botId, enabled: botAutomations.enabled, lastRunAt: botAutomations.lastRunAt, cadenceMinutes: botAutomations.cadenceMinutes })
    .from(botAutomations)
    .where(eq(botAutomations.enabled, true))
    .orderBy(botAutomations.lastRunAt);

  const outcomes: RunOutcome[] = [];
  for (const row of rows) {
    // Cheap pre-filter only. The authoritative "is it due?" decision is the
    // atomic claim inside runBotCycle, which is what prevents double-firing.
    const due = !row.lastRunAt || Date.now() >= new Date(row.lastRunAt).getTime() + row.cadenceMinutes * 60 * 1000;
    if (!due) continue;
    outcomes.push(await runBotCycle({ botId: row.botId }));
  }
  return outcomes;
}

export async function approveRun(runId: number, decision: "approve" | "dismiss") {
  const rows = await db.select().from(automationRuns).where(eq(automationRuns.id, runId)).limit(1);
  const run = rows[0];
  if (!run) return { ok: false as const, error: "Run not found" };
  if (run.status !== "pending") return { ok: false as const, error: "This action is already resolved." };

  if (decision === "dismiss") {
    await db.update(automationRuns).set({ status: "dismissed" }).where(eq(automationRuns.id, runId));
    return { ok: true as const, status: "dismissed" };
  }

  const botRows = await db.select().from(bots).where(eq(bots.id, run.botId)).limit(1);
  const bot = botRows[0];
  if (!bot) return { ok: false as const, error: "Bot not found" };
  const conversation = await ensureBotConversation(toBotView(bot));
  await db.insert(messages).values({
    conversationId: conversation.id,
    role: "assistant",
    content: `*messages you first*\n\n${run.content}`,
    engine: "autopilot",
  });
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));
  await db
    .update(automationRuns)
    .set({ status: "sent", conversationId: conversation.id })
    .where(eq(automationRuns.id, runId));
  return { ok: true as const, status: "sent", conversationId: conversation.id };
}

export async function setTaskDone(taskId: number, done: boolean) {
  const updated = await db
    .update(automationTasks)
    .set({ done })
    .where(eq(automationTasks.id, taskId))
    .returning({ id: automationTasks.id, done: automationTasks.done });
  return updated[0] ?? null;
}

export async function addTask(botId: number, title: string, detail = "") {
  const created = await db
    .insert(automationTasks)
    .values({ botId, title: title.slice(0, 160), detail: detail.slice(0, 400) })
    .returning();
  return created[0];
}

export async function autopilotSnapshot(): Promise<AutopilotSnapshot> {
  await ensureAutomations();
  const [automations, runs, tasks, runtime] = await Promise.all([
    listAutomations(),
    listRuns(40),
    listTasks(),
    getRuntime(),
  ]);
  const midnight = startOfLocalDay(new Date(), runtime.timezone);
  const todayRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(automationRuns)
    .where(gte(automationRuns.createdAt, midnight));
  const openTasks = tasks.filter((task) => !task.done).length;
  const pending = runs.filter((run) => run.status === "pending").length;
  return {
    automations,
    runs,
    tasks,
    stats: {
      enabled: automations.filter((item) => item.enabled).length,
      total: automations.length,
      actionsToday: todayRows[0]?.count ?? 0,
      pending,
      openTasks,
    },
    timezone: runtime.timezone,
  };
}


