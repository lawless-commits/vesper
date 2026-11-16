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
  const result = await probeRuntime({
    provider: String(body.provider ?? "demo"),
    baseUrl: String(body.baseUrl ?? ""),
    model: String(body.model ?? ""),
    apiKey: String(body.apiKey ?? ""),
    temperature: Number(body.temperature ?? 0.8),
    userName: String(body.userName ?? "You"),
  });
  return Response.json(result);
}
