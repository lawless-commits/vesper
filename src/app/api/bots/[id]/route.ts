import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bots } from "@/db/schema";
import { getBotById } from "@/lib/data";
import { badRequest, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = parseId(id);
  if (numericId === null) return badRequest("Bad id");
  const bot = await getBotById(numericId);
  if (!bot) return Response.json({ error: "Bot not found" }, { status: 404 });
  return Response.json({ bot });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = parseId(id);
  if (numericId === null) return badRequest("Bad id");
  const deleted = await db.delete(bots).where(eq(bots.id, numericId)).returning({ id: bots.id });
  if (!deleted[0]) return Response.json({ error: "Bot not found" }, { status: 404 });
  return Response.json({ ok: true });
}
