import { autopilotSnapshot, listAutomations, upsertAutomation } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await autopilotSnapshot();
  return Response.json(snapshot);
}

export async function PUT(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const botId = Number(body.botId);
  if (!Number.isInteger(botId)) return Response.json({ error: "botId is required" }, { status: 400 });

  const saved = await upsertAutomation({
    botId,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    cadenceMinutes: body.cadenceMinutes === undefined ? undefined : Number(body.cadenceMinutes),
    actions: Array.isArray(body.actions) ? body.actions.map((action) => String(action)) : undefined,
    dailyLimit: body.dailyLimit === undefined ? undefined : Number(body.dailyLimit),
    requireApproval: typeof body.requireApproval === "boolean" ? body.requireApproval : undefined,
    useModel: typeof body.useModel === "boolean" ? body.useModel : undefined,
  });

  return Response.json({ automation: saved, automations: await listAutomations() });
}
