import { approveRun, autopilotSnapshot } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = Number(body.id);
  const decision = body.decision === "dismiss" ? "dismiss" : "approve";
  if (!Number.isInteger(id)) return Response.json({ error: "id is required" }, { status: 400 });

  const result = await approveRun(id, decision);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ...result, snapshot: await autopilotSnapshot() });
}
