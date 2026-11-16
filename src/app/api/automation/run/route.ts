import { autopilotSnapshot, runBotCycle, tickAutomations } from "@/lib/autopilot";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs autonomy work. Callable by the UI heartbeat, by `curl`, or by cron:
 *   curl -X POST http://localhost:3000/api/automation/run -d '{"mode":"tick"}'
 * If AUTOPILOT_TOKEN is set in the environment, it must be supplied as
 * `x-autopilot-token` or `?token=`.
 */
export async function POST(request: Request) {
  const expected = process.env.AUTOPILOT_TOKEN;
  if (expected) {
    const url = new URL(request.url);
    const provided = request.headers.get("x-autopilot-token") ?? url.searchParams.get("token");
    if (provided !== expected) {
      return Response.json({ error: "Invalid autopilot token" }, { status: 401 });
    }
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const mode = String(body.mode ?? "tick");
  if (mode === "bot") {
    const botId = Number(body.botId);
    if (!Number.isInteger(botId)) return Response.json({ error: "botId is required" }, { status: 400 });
    const outcome = await runBotCycle({ botId, force: body.force !== false });
    return Response.json({ outcomes: [outcome], snapshot: await autopilotSnapshot() });
  }

  const outcomes = await tickAutomations();
  return Response.json({ outcomes, snapshot: await autopilotSnapshot() });
}
