import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bots, conversations, messages } from "@/db/schema";
import { listConversations } from "@/lib/data";
import { badRequest, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const botIdParam = new URL(request.url).searchParams.get("botId");
  const botId = botIdParam === null ? undefined : parseId(botIdParam);
  if (botId === null) return badRequest("Bad botId");
  const rows = await listConversations(botId);
  return Response.json({ conversations: rows });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const botId = parseId(body.botId);
  if (botId === null) return badRequest("botId is required");

  const botRows = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  const bot = botRows[0];
  if (!bot) return Response.json({ error: "Bot not found" }, { status: 404 });

  const reuseEmpty = body.reuseEmpty === true;
  if (reuseEmpty) {
    const existing = await db
      .select()
      .from(conversations)
      .where(eq(conversations.botId, botId))
      .orderBy(conversations.id);
    for (const conversation of existing) {
      const count = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .limit(2);
      if (count.length <= 1) {
        return Response.json({ conversation, created: false });
      }
    }
  }

  const created = await db
    .insert(conversations)
    .values({ botId, title: `Chat with ${bot.name}` })
    .returning();
  const conversation = created[0];

  if (bot.greeting) {
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: "assistant",
      content: bot.greeting,
      engine: "vesper-local",
    });
  }

  return Response.json({ conversation, created: true }, { status: 201 });
}
