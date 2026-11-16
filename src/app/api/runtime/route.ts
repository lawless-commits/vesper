import { db } from "@/db";
import { runtimeSettings } from "@/db/schema";
import { ensureSeeded, getRuntime } from "@/lib/data";

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

  const values = {
    id: 1,
    provider,
    baseUrl: String(body.baseUrl ?? "").trim().slice(0, 300) || "http://127.0.0.1:11434/v1",
    model: String(body.model ?? "").trim().slice(0, 120) || "llama3.2",
    apiKey: String(body.apiKey ?? "").slice(0, 300),
    temperature,
    userName: String(body.userName ?? "").trim().slice(0, 40) || "You",
    updatedAt: new Date(),
  };

  await db
    .insert(runtimeSettings)
    .values(values)
    .onConflictDoUpdate({ target: runtimeSettings.id, set: values });

  return Response.json({ runtime: await getRuntime() });
}
