import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { getConversation } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getConversation(Number(id));
  if (!result) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json(result);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = String(body.title ?? "").trim().slice(0, 120);
  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
  const updated = await db
    .update(conversations)
    .set({ title })
    .where(eq(conversations.id, numericId))
    .returning();
  if (!updated[0]) return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json({ conversation: updated[0] });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return Response.json({ error: "Bad id" }, { status: 400 });
  await db.delete(conversations).where(eq(conversations.id, numericId));
  return Response.json({ ok: true });
}
