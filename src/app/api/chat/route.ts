import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bots, conversations, messages, type Message } from "@/db/schema";
import { ensureSeeded, toBotView } from "@/lib/data";
import { badRequest, notFound, parseId } from "@/lib/http";
import { generateReply, streamReply } from "@/lib/runtime";
import { encodeServerEvent } from "@/lib/sse";
import type { MessageView } from "@/lib/types";
import { truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
// Must be at least the largest configurable model timeout (300s, see RUNTIME_LIMITS).
export const maxDuration = 300;

function toView(message: Message): MessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    engine: message.engine,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * One user turn → one in-character reply.
 *
 * Body: { conversationId, content, stream? }
 *
 * - Default: a single JSON response { userMessage, reply, engine, notice }.
 * - stream: true: a text/event-stream with these events, in order:
 *     user   { userMessage }            the saved user message
 *     delta  { text }                   zero or more pieces of the reply
 *     done   { reply, engine, notice }  the saved assistant message
 *     error  { error, userMessageId }   instead of done, if something failed
 *
 * The user message is saved first. The assistant message is written once,
 * when generation ends, in the same transaction as the conversation update.
 * If the client disconnects mid-stream (Stop button), whatever text had
 * arrived is saved as the reply.
 *
 * When a failure happens after the user message was saved, the error carries
 * userMessageId so the client can reload the transcript instead of resending
 * and duplicating the message.
 */
export async function POST(request: Request) {
  await ensureSeeded();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const conversationId = parseId(body.conversationId);
  const content = String(body.content ?? "").trim().slice(0, 4000);
  if (conversationId === null) return badRequest("conversationId is required");
  if (!content) return badRequest("Message is empty");

  const rows = await db
    .select({ conversation: conversations, bot: bots })
    .from(conversations)
    .innerJoin(bots, eq(conversations.botId, bots.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row) return notFound("Conversation not found");

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

  const bot = toBotView(row.bot);
  const history = historyRows.slice(-12).map((turn) => ({ role: turn.role, content: turn.content }));
  const humanTurns = historyRows.filter((turn) => turn.role === "user").length;
  const shouldRetitle = humanTurns === 0 || row.conversation.title.startsWith("Chat with");

  /** Write the reply and the conversation update together, or neither. */
  const saveReply = (replyContent: string, engine: string) =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(messages)
        .values({ conversationId, role: "assistant", content: replyContent, engine })
        .returning();
      await tx
        .update(conversations)
        .set({
          updatedAt: new Date(),
          ...(shouldRetitle ? { title: truncate(content.replace(/\s+/g, " "), 64) } : {}),
        })
        .where(eq(conversations.id, conversationId));
      return inserted[0];
    });

  const failure = { error: "The reply could not be completed. Your message was saved.", userMessageId: userMessage.id };

  if (body.stream !== true) {
    try {
      const result = await generateReply({ bot, history, userMessage: content });
      const reply = await saveReply(result.content, result.engine);
      return Response.json({
        userMessage: toView(userMessage),
        reply: toView(reply),
        engine: result.engine,
        notice: result.notice ?? null,
      });
    } catch (error) {
      console.error("chat: reply failed after the user message was saved", error);
      return Response.json(failure, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  // Aborting this stops the upstream model request. It fires when the browser
  // disconnects, which is how the Stop button reaches the model.
  const upstream = new AbortController();
  const stopUpstream = () => upstream.abort();
  if (request.signal.aborted) stopUpstream();
  else request.signal.addEventListener("abort", stopUpstream, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(encodeServerEvent(event, data)));
        } catch {
          // The client has gone away; keep going so the reply is still saved.
        }
      };

      send("user", { userMessage: toView(userMessage) });

      let text = "";
      let engine = "vesper-local";
      let notice: string | undefined;
      try {
        for await (const event of streamReply({ bot, history, userMessage: content, signal: upstream.signal })) {
          if (event.type === "delta") {
            text += event.text;
            send("delta", { text: event.text });
          } else {
            engine = event.engine;
            notice = event.notice;
          }
        }

        // Written once, at the end. After a Stop this is the partial text.
        const finalText = text.trim();
        if (finalText) {
          const reply = await saveReply(finalText, engine);
          send("done", { reply: toView(reply), engine, notice: notice ?? null });
        } else {
          send("error", failure);
        }
      } catch (error) {
        console.error("chat: streamed reply failed after the user message was saved", error);
        send("error", failure);
      } finally {
        request.signal.removeEventListener("abort", stopUpstream);
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
    cancel() {
      stopUpstream();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
