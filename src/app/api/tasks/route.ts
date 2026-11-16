import { addTask, autopilotSnapshot, setTaskDone } from "@/lib/autopilot";
import { getBotById } from "@/lib/data";
import { badRequest, notFound, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const botId = parseId(body.botId);
  const title = String(body.title ?? "").trim();
  if (botId === null) return badRequest("botId is required");
  if (!title) return badRequest("title is required");
  if (!(await getBotById(botId))) return notFound("Bot not found");
  const task = await addTask(botId, title, String(body.detail ?? ""));
  return Response.json({ task, snapshot: await autopilotSnapshot() }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = parseId(body.id);
  if (id === null) return badRequest("id is required");
  const updated = await setTaskDone(id, Boolean(body.done));
  if (!updated) return Response.json({ error: "Task not found" }, { status: 404 });
  return Response.json({ task: updated, snapshot: await autopilotSnapshot() });
}
