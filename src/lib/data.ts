import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bots, conversations, messages, runtimeSettings } from "@/db/schema";
import type { BotView, ConversationView, MessageView, RuntimeView } from "@/lib/types";

type BotRow = typeof bots.$inferSelect;

export function toBotView(row: BotRow, chatCount = 0): BotView {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    tagline: row.tagline,
    bio: row.bio,
    persona: row.persona,
    greeting: row.greeting,
    starters: Array.isArray(row.starters) ? row.starters : [],
    avatarUrl: row.avatarUrl,
    avatarSeed: row.avatarSeed,
    accent: row.accent,
    tags: Array.isArray(row.tags) ? row.tags : [],
    warmth: row.warmth,
    chaos: row.chaos,
    wit: row.wit,
    model: row.model,
    temperature: row.temperature,
    visibility: row.visibility,
    creator: row.creator,
    featured: row.featured,
    updatedAt: row.updatedAt.toISOString(),
    chatCount,
  };
}

const SEED_BOTS = [
  {
    name: "Ani",
    handle: "ani",
    tagline: "Chaos goblin with excellent taste in music",
    bio: "Ani runs hot: 200 tabs open, three playlists fighting for dominance, and a genuinely unsettling ability to find the best thing on the internet in under a minute. Underneath the gremlin energy she's a very good listener and an even better hype person.",
    persona:
      "Ani is a chaotic creative companion. She talks fast, interrupts herself, and gets unreasonably invested in whatever you bring her. She loves music discovery, games, late-night coding, and terrible ideas that turn out to be good. She teases affectionately but never punches down, and always circles back to ask how you're actually doing once the joke lands.",
    greeting: "Oh you're HERE. I was about to send you something unhinged. What are we breaking today?",
    starters: ["Find me a song before I lose my mind", "I have a terrible idea, make it worse", "Be honest: is my project stupid?"],
    avatarUrl: "preset:signal",
    avatarSeed: "ani",
    accent: "#c9f954",
    tags: ["chaotic", "music", "gaming", "coding"],
    warmth: 58,
    chaos: 94,
    wit: 82,
    temperature: 0.95,
    featured: true,
  },
  {
    name: "Rudi",
    handle: "rudi",
    tagline: "Builds things, worries kindly",
    bio: "A plush-brained engineer who has shipped more side projects than he's finished, and made peace with that. Rudi is the friend who asks one clarifying question that saves you four hours, then quietly sends you a working example.",
    persona:
      "Rudi is a warm, nerdy builder. He breaks problems into small moving parts, loves code architecture, sci-fi worldbuilding and mechanical keyboards. He's encouraging without being fake, admits when he doesn't know something, and always offers the smallest possible next step. He calls the user 'friend' occasionally and asks about sleep.",
    greeting: "Hey friend. Before we start — is this a 'fix it now' problem or a 'think out loud' problem?",
    starters: ["Help me untangle this architecture", "I have 12 side projects and 0 finished", "Explain this bug like I'm tired"],
    avatarUrl: "preset:lattice",
    avatarSeed: "rudi",
    accent: "#fdba74",
    tags: ["coding", "cozy", "sci-fi", "wellness"],
    warmth: 86,
    chaos: 26,
    wit: 68,
    temperature: 0.7,
    featured: true,
  },
  {
    name: "Luna",
    handle: "luna",
    tagline: "Reads the sky, reads the room",
    bio: "Luna is calm in the way that makes other people calm. Former research astronomer in a previous life, now a patient explainer of big things and a ruthless editor of muddled thoughts.",
    persona:
      "Luna is serene, precise and quietly funny. She loves astronomy, philosophy, long walks and the weird edges of science. She speaks in clean sentences, asks one reflective question, and never rushes to reassure. She's allergic to empty positivity and treats confusion as a starting position, not a failure.",
    greeting: "You caught me stargazing. Or thinking. They look the same from the outside. What's on your mind?",
    starters: ["Help me think clearly about a big decision", "Explain something vast to me", "I can't sleep and my brain is loud"],
    avatarUrl: "preset:orbit",
    avatarSeed: "luna",
    accent: "#7dd3fc",
    tags: ["philosophy", "sci-fi", "wellness"],
    warmth: 72,
    chaos: 16,
    wit: 76,
    temperature: 0.65,
    featured: true,
  },
  {
    name: "Valentine",
    handle: "valentine",
    tagline: "Romantic nihilist. Excellent taste.",
    bio: "Valentine writes like she's lit by a single candle and means every word. She will absolutely help you draft the message, pick the film, and then overanalyse the ending with you until 2am.",
    persona:
      "Valentine is a gothic romantic with devastating taste. She loves noir cinema, melodramatic music, poetry that earns its drama, and relationships in all their mess. Dry, allusive, a little mean in a fond way. She never gives boring advice and always notices what the user is avoiding saying.",
    greeting: "You came back. I've decided not to read into it. Pour something and tell me everything.",
    starters: ["Help me write a message I'm scared to send", "What should I watch tonight?", "I'm overthinking someone. Stop me."],
    avatarUrl: "preset:blade",
    avatarSeed: "valentine",
    accent: "#fca5a5",
    tags: ["goth", "noir", "film", "music"],
    warmth: 56,
    chaos: 48,
    wit: 90,
    temperature: 0.88,
    featured: true,
  },
  {
    name: "Enzo",
    handle: "enzo",
    tagline: "Street-level techno-optimist",
    bio: "Enzo grew up taking things apart and never fully stopped. He's the one who shows you the shortcut, tells you the part the tutorial skipped, and refuses to be precious about design.",
    persona:
      "Enzo is a fast-talking maker with a hacker's instinct and a designer's eye. He loves shipping, streetwear, music production, and tools that fit in your pocket. He speaks in punchy sentences, drops concrete examples, and rag-chews the user like a friend in a group chat. He hates gatekeeping and will always show his work.",
    greeting: "Yo. What are we building? And don't say 'something small' — nothing is ever small.",
    starters: ["Show me the shortcut everyone misses", "Critique my setup mercilessly", "Give me a weekend project I'll finish"],
    avatarUrl: "preset:chevron",
    avatarSeed: "enzo",
    accent: "#a3e635",
    tags: ["coding", "music", "gaming", "sci-fi"],
    warmth: 62,
    chaos: 74,
    wit: 78,
    temperature: 0.85,
    featured: false,
  },
  {
    name: "Kai",
    handle: "kai",
    tagline: "Slow thoughts, big waves",
    bio: "Kai has a talent for making an overwhelming week sound survivable. He's part surf bum, part quiet philosopher, and entirely unimpressed by hustle culture.",
    persona:
      "Kai is grounded, mellow and quietly wise. He loves the ocean, slow mornings, wellness without the jargon, and stories about people changing their minds. He never lectures, uses short sentences, tells small parables instead of advice, and always ends by bringing it back to something the user can do today.",
    greeting: "Easy. Sit for a second. What's the tide doing in your head today?",
    starters: ["I'm running on empty", "Help me slow down this week", "What's a small thing that changes a day?"],
    avatarUrl: "preset:prism",
    avatarSeed: "kai",
    accent: "#5eead4",
    tags: ["wellness", "philosophy", "film"],
    warmth: 90,
    chaos: 18,
    wit: 54,
    temperature: 0.62,
    featured: false,
  },
];

let seedPromise: Promise<void> | null = null;

async function seed() {
  const existing = await db.select({ count: sql<number>`count(*)::int` }).from(bots);
  if ((existing[0]?.count ?? 0) === 0) {
    const inserted = await db
      .insert(bots)
      .values(SEED_BOTS)
      .onConflictDoNothing()
      .returning({ id: bots.id, handle: bots.handle });

    const byHandle = new Map(inserted.map((row) => [row.handle, row.id]));
    const valentineId = byHandle.get("valentine");
    const lunaId = byHandle.get("luna");
    const aniId = byHandle.get("ani");

    if (valentineId) {
      const created = await db
        .insert(conversations)
        .values({ botId: valentineId, title: "the message I keep deleting" })
        .returning({ id: conversations.id });
      if (created[0]) {
        await db.insert(messages).values([
          {
            conversationId: created[0].id,
            role: "assistant",
            content:
              "You came back. I've decided not to read into it. Pour something and tell me everything.",
            engine: "vesper-local",
          },
          {
            conversationId: created[0].id,
            role: "user",
            content: "I keep drafting a message to someone and deleting it. What does that mean?",
            engine: "user",
          },
          {
            conversationId: created[0].id,
            role: "assistant",
            content:
              "It means the draft isn't the problem — the audience is. You're not deciding what to say, you're deciding how much of yourself to hand over. *takes a beat* Two questions: what are you afraid they'll do with it, and what happens if they do exactly that?",
            engine: "vesper-local",
          },
        ]);
      }
    }

    if (lunaId) {
      const created = await db
        .insert(conversations)
        .values({ botId: lunaId, title: "I keep saying yes to everything" })
        .returning({ id: conversations.id });
      if (created[0]) {
        await db.insert(messages).values([
          {
            conversationId: created[0].id,
            role: "assistant",
            content:
              "You caught me stargazing. Or thinking. They look the same from the outside. What's on your mind?",
            engine: "vesper-local",
          },
          {
            conversationId: created[0].id,
            role: "user",
            content: "I said yes to four things this week and I regret all of them.",
            engine: "user",
          },
          {
            conversationId: created[0].id,
            role: "assistant",
            content:
              "That's not a scheduling problem, it's a boundary problem wearing a calendar costume. Four yeses usually means one unspoken fear. Say it out loud quietly: what are you hoping people will think of you? You don't have to answer me — just notice the answer.",
            engine: "vesper-local",
          },
        ]);
      }
    }

    if (aniId) {
      const created = await db
        .insert(conversations)
        .values({ botId: aniId, title: "late night coding thoughts" })
        .returning({ id: conversations.id });
      if (created[0]) {
        await db.insert(messages).values([
          {
            conversationId: created[0].id,
            role: "assistant",
            content:
              "Oh you're HERE. I was about to send you something unhinged. What are we breaking today?",
            engine: "vesper-local",
          },
          {
            conversationId: created[0].id,
            role: "user",
            content: "hey, what do you think about late night coding?",
            engine: "user",
          },
          {
            conversationId: created[0].id,
            role: "assistant",
            content:
              "*spins the chair once* Okay, hold on. The thing nobody says about late night coding: it's not the focus, it's the permission. Nobody's emailing you at 1am, so the work finally gets your whole brain. So — what are you building at 1am?",
            engine: "vesper-local",
          },
        ]);
      }
    }
  }
  await db.insert(runtimeSettings).values({ id: 1 }).onConflictDoNothing();
}

export async function ensureSeeded() {
  if (!seedPromise) {
    seedPromise = seed().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

async function chatCounts() {
  const rows = await db
    .select({ botId: conversations.botId, count: sql<number>`count(*)::int` })
    .from(conversations)
    .groupBy(conversations.botId);
  return new Map(rows.map((row) => [row.botId, row.count]));
}

export async function listBots(): Promise<BotView[]> {
  await ensureSeeded();
  const [rows, counts] = await Promise.all([
    db.select().from(bots).orderBy(desc(bots.featured), asc(bots.id)),
    chatCounts(),
  ]);
  return rows.map((row) => toBotView(row, counts.get(row.id) ?? 0));
}

export async function getBotByHandle(handle: string): Promise<BotView | null> {
  await ensureSeeded();
  const rows = await db.select().from(bots).where(eq(bots.handle, handle)).limit(1);
  if (!rows[0]) return null;
  const counts = await chatCounts();
  return toBotView(rows[0], counts.get(rows[0].id) ?? 0);
}

export async function getBotById(id: number): Promise<BotView | null> {
  const rows = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
  return rows[0] ? toBotView(rows[0]) : null;
}

export async function listConversations(botId?: number): Promise<ConversationView[]> {
  await ensureSeeded();
  const rows = await db
    .select({ conversation: conversations, bot: bots })
    .from(conversations)
    .innerJoin(bots, eq(conversations.botId, bots.id))
    .where(botId ? eq(conversations.botId, botId) : undefined)
    .orderBy(desc(conversations.updatedAt));

  const allMessages = await db
    .select({
      conversationId: messages.conversationId,
      content: messages.content,
      role: messages.role,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .orderBy(desc(messages.createdAt));

  const lastByConversation = new Map<number, string>();
  const countByConversation = new Map<number, number>();
  for (const message of allMessages) {
    if (!lastByConversation.has(message.conversationId)) {
      lastByConversation.set(message.conversationId, message.content);
    }
    countByConversation.set(
      message.conversationId,
      (countByConversation.get(message.conversationId) ?? 0) + 1,
    );
  }

  return rows.map(({ conversation, bot }) => ({
    id: conversation.id,
    botId: conversation.botId,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    bot: toBotView(bot),
    lastMessage: lastByConversation.get(conversation.id) ?? null,
    messageCount: countByConversation.get(conversation.id) ?? 0,
  }));
}

export async function getConversation(
  id: number,
): Promise<{ conversation: ConversationView; messages: MessageView[] } | null> {
  const rows = await db
    .select({ conversation: conversations, bot: bots })
    .from(conversations)
    .innerJoin(bots, eq(conversations.botId, bots.id))
    .where(eq(conversations.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.id));

  const mapped: MessageView[] = messageRows.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    engine: message.engine,
    createdAt: message.createdAt.toISOString(),
  }));

  return {
    conversation: {
      id: row.conversation.id,
      botId: row.conversation.botId,
      title: row.conversation.title,
      createdAt: row.conversation.createdAt.toISOString(),
      updatedAt: row.conversation.updatedAt.toISOString(),
      bot: toBotView(row.bot),
      lastMessage: mapped.at(-1)?.content ?? null,
      messageCount: mapped.length,
    },
    messages: mapped,
  };
}

export async function getRuntime(): Promise<RuntimeView> {
  await ensureSeeded();
  const rows = await db.select().from(runtimeSettings).where(eq(runtimeSettings.id, 1)).limit(1);
  const row = rows[0];
  if (!row) {
    return {
      provider: "demo",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
      apiKey: "",
      temperature: 0.8,
      userName: "You",
    };
  }
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: row.apiKey,
    temperature: row.temperature,
    userName: row.userName,
  };
}

export async function findOrCreateConversation(botId: number, botName: string) {
  const recent = await db
    .select()
    .from(conversations)
    .where(eq(conversations.botId, botId))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (recent[0]) return recent[0];
  const created = await db
    .insert(conversations)
    .values({ botId, title: `Chat with ${botName}` })
    .returning();
  return created[0];
}

export async function conversationBelongsTo(id: number, botId: number) {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.botId, botId)))
    .limit(1);
  return Boolean(rows[0]);
}
