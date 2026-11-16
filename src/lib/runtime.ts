import { getRuntime } from "@/lib/data";
import { buildSystemPrompt, generateDemoReply, type ChatTurn } from "@/lib/persona";
import type { BotView, RuntimeView } from "@/lib/types";

export type ReplyResult = {
  content: string;
  engine: string;
  notice?: string;
};

export type RuntimeConfig = RuntimeView;

function normalizeBase(baseUrl: string) {
  return (baseUrl || "").trim().replace(/\/+$/, "");
}

function openAiEndpoint(baseUrl: string) {
  const base = normalizeBase(baseUrl);
  if (!base) throw new Error("Local server URL is empty");
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/v1/chat/completions`;
}

function ollamaEndpoint(baseUrl: string) {
  const base = normalizeBase(baseUrl).replace(/\/v1$/i, "");
  if (!base) throw new Error("Local server URL is empty");
  return `${base}/api/chat`;
}

function toModelMessages(system: string, history: ChatTurn[], userMessage: string) {
  const trimmed = history.filter((turn) => turn.content?.trim()).slice(-12);
  return [
    { role: "system", content: system },
    ...trimmed.map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content.slice(0, 4000),
    })),
    { role: "user", content: userMessage.slice(0, 4000) },
  ];
}

async function callOpenAiCompatible(
  config: RuntimeConfig,
  system: string,
  history: ChatTurn[],
  userMessage: string,
) {
  const response = await fetch(openAiEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: toModelMessages(system, history, userMessage),
      temperature: config.temperature,
      max_tokens: 420,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 180)}` : ""}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("The local model returned an empty response");
  return content;
}

async function callOllama(
  config: RuntimeConfig,
  system: string,
  history: ChatTurn[],
  userMessage: string,
) {
  const response = await fetch(ollamaEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: toModelMessages(system, history, userMessage),
      stream: false,
      options: { temperature: config.temperature },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 180)}` : ""}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  const content = data.message?.content?.trim();
  if (!content) throw new Error("The local model returned an empty response");
  return content;
}

export async function generateReply(input: {
  bot: BotView;
  history: ChatTurn[];
  userMessage: string;
}): Promise<ReplyResult> {
  const { bot, history, userMessage } = input;
  const runtime = await getRuntime();
  const userName = runtime.userName || "you";

  if (runtime.provider === "demo") {
    return {
      content: generateDemoReply({ bot, history, userMessage, userName }),
      engine: "vesper-local",
    };
  }

  const system = buildSystemPrompt(bot, userName);
  try {
    const content =
      runtime.provider === "ollama"
        ? await callOllama(runtime, system, history, userMessage)
        : await callOpenAiCompatible(runtime, system, history, userMessage);
    return { content, engine: `${runtime.provider}:${runtime.model}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return {
      content: generateDemoReply({ bot, history, userMessage, userName }),
      engine: "vesper-local",
      notice: `Couldn't reach your local model (${reason}). Replied with the built-in engine.`,
    };
  }
}

export async function probeRuntime(config: Partial<RuntimeConfig>) {
  const provider = config.provider ?? "demo";
  const baseUrl = normalizeBase(config.baseUrl ?? "");
  if (provider === "demo") {
    return { ok: true, detail: "Built-in engine is always available. No server needed." };
  }
  if (!baseUrl) return { ok: false, detail: "Add a local server URL first." };

  try {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const url =
      provider === "ollama"
        ? `${baseUrl.replace(/\/v1$/i, "")}/api/tags`
        : `${normalizeBase(openAiEndpoint(baseUrl)).replace(/\/chat\/completions$/i, "")}/models`;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      return { ok: false, detail: `Server responded ${response.status} ${response.statusText}.` };
    }
    const data = (await response.json().catch(() => ({}))) as {
      data?: Array<{ id?: string }>;
      models?: Array<{ name?: string }>;
    };
    const models = (data.data?.map((m) => m.id) ?? data.models?.map((m) => m.name) ?? []).filter(
      (value): value is string => Boolean(value),
    );
    return {
      ok: true,
      detail: models.length
        ? `Connected. ${models.length} model${models.length === 1 ? "" : "s"} available: ${models.slice(0, 5).join(", ")}`
        : "Connected to your local server.",
      models,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `Couldn't connect: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
