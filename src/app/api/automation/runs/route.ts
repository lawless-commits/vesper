import { approveRun, autopilotSnapshot } from "@/lib/autopilot";
import { badRequest, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = parseId(body.id);
  const decision = body.decision === "dismiss" ? "dismiss" : "approve";
  if (id === null) return badRequest("id is required");

  const result = await approveRun(id, decision);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ...result, snapshot: await autopilotSnapshot() });
}
