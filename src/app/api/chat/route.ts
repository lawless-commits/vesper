import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bots, conversations, messages } from "@/db/schema";
import { ensureSeeded, toBotView } from "@/lib/data";
import { badRequest, parseId } from "@/lib/http";
import { generateReply } from "@/lib/runtime";
import { truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  await ensureSeeded();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const conversationId = parseId(body.conversationId);
  const content = String(body.content ?? "").trim().slice(0, 4000);
  if (conversationId === null) return badRequest("conversationId is required");
  if (!content) return Response.json({ error: "Message is empty" }, { status: 400 });

  const rows = await db
    .select({ conversation: conversations, bot: bots })
    .from(conversations)
    .innerJoin(bots, eq(conversations.botId, bots.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "Conversation not found" }, { status: 404 });

  const userInsert = await db
    .insert(messages)
    .values({ conversationId, role: "user", content, engine: "user" })
    .returning();
  const userMessage = userInsert[0];

  const historyRows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), sql`${messages.id} <> ${userMessage.id}`))
    .orderBy(asc(messages.id));

  const result = await generateReply({
    bot: toBotView(row.bot),
    history: historyRows.slice(-12).map((turn) => ({ role: turn.role, content: turn.content })),
    userMessage: content,
  });

  const replyInsert = await db
    .insert(messages)
    .values({
      conversationId,
      role: "assistant",
      content: result.content,
      engine: result.engine,
    })
    .returning();

  const humanTurns = historyRows.filter((turn) => turn.role === "user").length;
  const shouldRetitle = humanTurns === 0 || row.conversation.title.startsWith("Chat with");
  await db
    .update(conversations)
    .set({
      updatedAt: new Date(),
      ...(shouldRetitle ? { title: truncate(content.replace(/\s+/g, " "), 64) } : {}),
    })
    .where(eq(conversations.id, conversationId));

  return Response.json({
    userMessage: {
      id: userMessage.id,
      role: userMessage.role,
      content: userMessage.content,
      engine: userMessage.engine,
      createdAt: userMessage.createdAt.toISOString(),
    },
    reply: {
      id: replyInsert[0].id,
      role: replyInsert[0].role,
      content: replyInsert[0].content,
      engine: replyInsert[0].engine,
      createdAt: replyInsert[0].createdAt.toISOString(),
    },
    engine: result.engine,
    notice: result.notice ?? null,
  });
}
