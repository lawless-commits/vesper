import { autopilotSnapshot, listAutomations, upsertAutomation } from "@/lib/autopilot";
import { getBotById } from "@/lib/data";
import { badRequest, notFound, parseId } from "@/lib/http";

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

  const botId = parseId(body.botId);
  if (botId === null) return badRequest("botId is required");
  if (!(await getBotById(botId))) return notFound("Bot not found");

  // Numeric settings are clamped by upsertAutomation; here we only reject
  // values that are not numbers at all, which would otherwise reach Postgres.
  const cadenceMinutes = body.cadenceMinutes === undefined ? undefined : Math.round(Number(body.cadenceMinutes));
  const dailyLimit = body.dailyLimit === undefined ? undefined : Math.round(Number(body.dailyLimit));
  if (cadenceMinutes !== undefined && !Number.isFinite(cadenceMinutes)) return badRequest("cadenceMinutes must be a number");
  if (dailyLimit !== undefined && !Number.isFinite(dailyLimit)) return badRequest("dailyLimit must be a number");

  const saved = await upsertAutomation({
    botId,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    cadenceMinutes,
    actions: Array.isArray(body.actions) ? body.actions.map((action) => String(action)) : undefined,
    dailyLimit,
    requireApproval: typeof body.requireApproval === "boolean" ? body.requireApproval : undefined,
    useModel: typeof body.useModel === "boolean" ? body.useModel : undefined,
  });

  return Response.json({ automation: saved, automations: await listAutomations() });
}
