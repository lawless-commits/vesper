import { addTask, autopilotSnapshot, setTaskDone } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const botId = Number(body.botId);
  const title = String(body.title ?? "").trim();
  if (!Number.isInteger(botId)) return Response.json({ error: "botId is required" }, { status: 400 });
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
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
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "id is required" }, { status: 400 });
  const updated = await setTaskDone(id, Boolean(body.done));
  if (!updated) return Response.json({ error: "Task not found" }, { status: 404 });
  return Response.json({ task: updated, snapshot: await autopilotSnapshot() });
}
