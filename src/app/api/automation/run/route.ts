import { autopilotSnapshot, runBotCycle, tickAutomations } from "@/lib/autopilot";
import { isSameOrigin, secretMatches } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Runs autonomy work. Callable by the UI heartbeat, by `curl`, or by cron:
 *   curl -X POST http://localhost:3000/api/automation/run \
 *     -H 'content-type: application/json' \
 *     -H "x-autopilot-token: $AUTOPILOT_TOKEN" \
 *     -d '{"mode":"tick"}'
 * If AUTOPILOT_TOKEN is set in the environment, a request is accepted only when
 * it comes from the app's own pages (same-origin) or carries the token in the
 * `x-autopilot-token` header. The token is never read from the query string,
 * because URLs end up in logs.
 */
export async function POST(request: Request) {
  const expected = process.env.AUTOPILOT_TOKEN;
  if (expected) {
    const allowed =
      isSameOrigin(request) || secretMatches(request.headers.get("x-autopilot-token"), expected);
    if (!allowed) {
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
