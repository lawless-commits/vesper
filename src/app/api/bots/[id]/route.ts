import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bots } from "@/db/schema";
import { getBotById } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bot = await getBotById(Number(id));
  if (!bot) return Response.json({ error: "Bot not found" }, { status: 404 });
  return Response.json({ bot });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return Response.json({ error: "Bad id" }, { status: 400 });
  const deleted = await db.delete(bots).where(eq(bots.id, numericId)).returning({ id: bots.id });
  if (!deleted[0]) return Response.json({ error: "Bot not found" }, { status: 404 });
  return Response.json({ ok: true });
}
