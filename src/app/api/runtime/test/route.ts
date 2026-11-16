import { getRuntimeConfig } from "@/lib/data";
import { probeRuntime } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  // The browser never holds the saved key, so fall back to it (or to
  // LLM_API_KEY) when the form did not supply a new one.
  const suppliedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiKey = suppliedKey || (body.clearApiKey === true ? "" : (await getRuntimeConfig()).apiKey);
  const result = await probeRuntime({
    provider: String(body.provider ?? "demo"),
    baseUrl: String(body.baseUrl ?? ""),
    model: String(body.model ?? ""),
    apiKey,
    temperature: Number(body.temperature ?? 0.8),
    userName: String(body.userName ?? "You"),
  });
  return Response.json(result);
}
