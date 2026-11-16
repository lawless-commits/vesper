import { getRuntimeConfig, type RuntimeConfig } from "@/lib/data";
import { buildSystemPrompt, generateDemoReply, type ChatTurn } from "@/lib/persona";
import type { BotView } from "@/lib/types";

export type ReplyResult = {
  content: string;
  engine: string;
  notice?: string;
};

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
      max_tokens: config.maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
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
      // num_predict is Ollama's name for the reply token limit.
      options: { temperature: config.temperature, num_predict: config.maxTokens },
    }),
    signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
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
  const runtime = await getRuntimeConfig();
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
    return {
      content: generateDemoReply({ bot, history, userMessage, userName }),
      engine: "vesper-local",
      notice: fallbackNotice(error, runtime.timeoutSeconds),
    };
  }
}

function isTimeout(error: unknown) {
  return error instanceof Error && error.name === "TimeoutError";
}

/**
 * Explain why the configured model was not used, distinguishing "it took too
 * long" (raise the timeout, or the model is still loading) from "it could not
 * be reached or returned an error".
 */
export function fallbackNotice(error: unknown, timeoutSeconds: number) {
  if (isTimeout(error)) {
    return `Your model timed out after ${timeoutSeconds}s (it may still be loading — you can raise the timeout in Runtime). Replied with the built-in engine.`;
  }
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const code = cause && "code" in cause ? String((cause as { code?: unknown }).code ?? "") : "";
  const base = error instanceof Error ? error.message : "unknown error";
  const reason = code ? `${base}: ${code}` : cause?.message ? `${base}: ${cause.message}` : base;
  return `Couldn't reach your model (${reason}). Replied with the built-in engine.`;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  /** Always the last event. `stopped` means the caller aborted mid-reply. */
  | { type: "done"; engine: string; notice?: string; stopped?: boolean };

/**
 * Abort signal that fires when the model has been silent for `seconds`, or
 * when the caller's own signal fires. Unlike AbortSignal.timeout this is an
 * idle timer: call touch() whenever data arrives, so a long reply that keeps
 * producing tokens is never cut off.
 */
function idleTimeout(seconds: number, outer?: AbortSignal) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
      seconds * 1000,
    );
  };
  const onOuterAbort = () => controller.abort(outer?.reason);
  if (outer?.aborted) onOuterAbort();
  else outer?.addEventListener("abort", onOuterAbort, { once: true });
  touch();
  return {
    signal: controller.signal,
    touch,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    },
  };
}

/** Yield a streamed response body one line at a time. */
async function* readLines(response: Response, onData: () => void): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onData();
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function failedResponse(response: Response) {
  const detail = await response.text().catch(() => "");
  return new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 180)}` : ""}`);
}

/** OpenAI-compatible streaming: SSE `data:` lines ending with `data: [DONE]`. */
async function* streamOpenAiCompatible(
  config: RuntimeConfig,
  system: string,
  history: ChatTurn[],
  userMessage: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const guard = idleTimeout(config.timeoutSeconds, signal);
  try {
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
        max_tokens: config.maxTokens,
        stream: true,
      }),
      signal: guard.signal,
    });
    if (!response.ok) throw await failedResponse(response);

    // Non-streaming fallback: some servers ignore stream:true and answer with
    // one ordinary JSON body.
    if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (content) yield content;
      return;
    }

    for await (const line of readLines(response, guard.touch)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") break;
      try {
        const data = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const text = data.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // Skip keep-alives and anything that is not a JSON chunk.
      }
    }
  } finally {
    guard.clear();
  }
}

/** Ollama streaming: one JSON object per line (NDJSON) from /api/chat. */
async function* streamOllama(
  config: RuntimeConfig,
  system: string,
  history: ChatTurn[],
  userMessage: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const guard = idleTimeout(config.timeoutSeconds, signal);
  try {
    const response = await fetch(ollamaEndpoint(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: toModelMessages(system, history, userMessage),
        stream: true,
        options: { temperature: config.temperature, num_predict: config.maxTokens },
      }),
      signal: guard.signal,
    });
    if (!response.ok) throw await failedResponse(response);

    // A server that ignores stream:true sends a single JSON object, which is
    // also a valid one-line NDJSON stream, so the same loop covers both. If
    // that object is pretty-printed over several lines, `raw` catches it.
    let parsedAny = false;
    let raw = "";
    for await (const line of readLines(response, guard.touch)) {
      if (!line.trim()) continue;
      raw += line;
      let data: { message?: { content?: string }; error?: string; done?: boolean };
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      parsedAny = true;
      if (data.error) throw new Error(data.error);
      if (data.message?.content) yield data.message.content;
      if (data.done) break;
    }
    if (!parsedAny && raw) {
      const data = JSON.parse(raw) as { message?: { content?: string }; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.message?.content) yield data.message.content;
    }
  } finally {
    guard.clear();
  }
}

/**
 * Streaming version of generateReply. Yields text deltas as the model
 * produces them, then exactly one `done` event.
 *
 * - Built-in engine: the whole reply arrives as a single delta.
 * - Model fails before producing anything: falls back to the built-in engine
 *   with a notice, exactly like generateReply.
 * - Model fails part-way: keeps the partial text and reports why it stopped.
 * - Caller aborts `signal` (Stop button, closed tab): ends with stopped: true
 *   so the caller can save whatever text it already received.
 */
export async function* streamReply(input: {
  bot: BotView;
  history: ChatTurn[];
  userMessage: string;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const { bot, history, userMessage, signal } = input;
  const runtime = await getRuntimeConfig();
  const userName = runtime.userName || "you";
  const builtIn = () => generateDemoReply({ bot, history, userMessage, userName });

  if (runtime.provider === "demo") {
    yield { type: "delta", text: builtIn() };
    yield { type: "done", engine: "vesper-local" };
    return;
  }

  const engine = `${runtime.provider}:${runtime.model}`;
  const system = buildSystemPrompt(bot, userName);
  let produced = false;
  try {
    const chunks =
      runtime.provider === "ollama"
        ? streamOllama(runtime, system, history, userMessage, signal)
        : streamOpenAiCompatible(runtime, system, history, userMessage, signal);
    for await (const text of chunks) {
      produced = produced || text.trim().length > 0;
      yield { type: "delta", text };
    }
    if (!produced) throw new Error("The local model returned an empty response");
    yield { type: "done", engine };
  } catch (error) {
    if (signal?.aborted) {
      yield { type: "done", engine, stopped: true };
    } else if (produced) {
      const why = isTimeout(error)
        ? `the model went silent for ${runtime.timeoutSeconds}s`
        : error instanceof Error
          ? error.message
          : "unknown error";
      yield { type: "done", engine, notice: `The reply was cut short (${why}). The part that arrived was kept.` };
    } else {
      yield { type: "delta", text: builtIn() };
      yield { type: "done", engine: "vesper-local", notice: fallbackNotice(error, runtime.timeoutSeconds) };
    }
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
