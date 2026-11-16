import { db } from "@/db";
import { runtimeSettings } from "@/db/schema";
import { ensureSeeded, getRuntime } from "@/lib/data";
import { badRequest } from "@/lib/http";
import { isValidTimeZone } from "@/lib/time";
import { clampRuntimeLimit } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = await getRuntime();
  return Response.json({ runtime });
}

export async function PUT(request: Request) {
  await ensureSeeded();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = ["demo", "ollama", "openai"].includes(String(body.provider))
    ? String(body.provider)
    : "demo";
  const temperatureRaw = Number(body.temperature);
  const temperature = Number.isFinite(temperatureRaw)
    ? Math.min(1.5, Math.max(0, temperatureRaw))
    : 0.8;

  // Timezone is optional; when present it must be a real IANA name.
  const timezoneRaw = typeof body.timezone === "string" ? body.timezone.trim() : undefined;
  if (timezoneRaw !== undefined && !isValidTimeZone(timezoneRaw)) {
    return badRequest(`Unknown timezone "${timezoneRaw.slice(0, 64)}". Use an IANA name such as Africa/Johannesburg.`);
  }

  // The key is write-only: an empty or missing apiKey keeps whatever is
  // stored, and only an explicit clearApiKey: true removes it.
  const newApiKey = typeof body.apiKey === "string" ? body.apiKey.trim().slice(0, 300) : "";
  const apiKeyChange = body.clearApiKey === true ? { apiKey: "" } : newApiKey ? { apiKey: newApiKey } : {};

  const values = {
    id: 1,
    provider,
    baseUrl: String(body.baseUrl ?? "").trim().slice(0, 300) || "http://127.0.0.1:11434/v1",
    model: String(body.model ?? "").trim().slice(0, 120) || "llama3.2",
    ...apiKeyChange,
    temperature,
    userName: String(body.userName ?? "").trim().slice(0, 40) || "You",
    ...(timezoneRaw !== undefined ? { timezone: timezoneRaw } : {}),
    // Optional: left unchanged when the caller does not send them.
    ...(body.timeoutSeconds !== undefined
      ? { timeoutSeconds: clampRuntimeLimit("timeoutSeconds", body.timeoutSeconds) }
      : {}),
    ...(body.maxTokens !== undefined ? { maxTokens: clampRuntimeLimit("maxTokens", body.maxTokens) } : {}),
    updatedAt: new Date(),
  };

  await db
    .insert(runtimeSettings)
    .values(values)
    .onConflictDoUpdate({ target: runtimeSettings.id, set: values });

  return Response.json({ runtime: await getRuntime() });
}
