"use client";

import { useState } from "react";
import { BoltIcon, CheckIcon, CloseIcon, ShieldIcon, SparkIcon } from "@/components/Icons";
import type { RuntimeView } from "@/lib/types";

const PROVIDERS = [
  {
    id: "demo",
    name: "Built-in engine",
    tag: "zero setup",
    description:
      "Vesper's own offline personality engine. Every bot replies using its dials, tags and persona — no model, no download.",
    baseUrl: "",
    model: "vesper-local-1",
  },
  {
    id: "ollama",
    name: "Ollama",
    tag: "recommended",
    description:
      "Point at a model running under Ollama on this machine. Best balance of quality and privacy for local companions.",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.2",
  },
  {
    id: "openai",
    name: "OpenAI-compatible",
    tag: "LM Studio · llama.cpp · vLLM",
    description:
      "Any local server that speaks the /v1/chat/completions API. Use LM Studio's server tab, llama.cpp or vLLM.",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
  },
];

const FIELD =
  "w-full rounded-xl border border-line bg-ink/60 px-3 py-2.5 text-sm text-white placeholder:text-muted/50 focus:border-lime/50 focus:ring-2 focus:ring-lime/10 focus:outline-none";
const LABEL = "mb-1.5 block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase";

const MODELS = ["llama3.2", "qwen2.5", "mistral", "gemma2", "phi3", "llama3.1:8b"];

export function RuntimeForm({ initial }: { initial: RuntimeView }) {
  const [provider, setProvider] = useState(initial.provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  // The saved key is never sent to the browser. This field only holds a new
  // key the user is typing; blank means "keep what is stored".
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(initial.hasApiKey);
  const [apiKeySource, setApiKeySource] = useState(initial.apiKeySource);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [temperature, setTemperature] = useState(initial.temperature);
  const [userName, setUserName] = useState(initial.userName);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const payload = {
    provider,
    baseUrl,
    model,
    temperature,
    userName,
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : clearApiKey ? { clearApiKey: true } : {}),
  };
  const keyFromEnv = apiKeySource === "env";
  const keySaved = hasApiKey && !clearApiKey;

  async function save() {
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/runtime", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { runtime?: RuntimeView; error?: string };
      if (!response.ok || !data.runtime) throw new Error(data.error ?? "Could not save runtime settings");
      setBaseUrl(data.runtime.baseUrl);
      setModel(data.runtime.model);
      setHasApiKey(data.runtime.hasApiKey);
      setApiKeySource(data.runtime.apiKeySource);
      setApiKey("");
      setClearApiKey(false);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save runtime settings");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch("/api/runtime/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { ok?: boolean; detail?: string };
      setResult({ ok: Boolean(data.ok), detail: data.detail ?? "No response" });
    } catch {
      setResult({ ok: false, detail: "Couldn't reach the test endpoint." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3">
        {PROVIDERS.map((option) => {
          const active = provider === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setProvider(option.id);
                if (option.id !== "demo") {
                  setBaseUrl(option.baseUrl);
                  if (!model || model === "vesper-local-1" || model === "local-model") setModel(option.model);
                }
                setResult(null);
              }}
              className={`rounded-2xl border p-4 text-left transition ${
                active
                  ? "border-lime/45 bg-lime/[0.06]"
                  : "border-line/70 bg-panel/40 hover:border-line hover:bg-panel/70"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`grid h-4 w-4 place-items-center rounded-full border ${
                    active ? "border-lime" : "border-muted/50"
                  }`}
                >
                  {active ? <span className="h-2 w-2 rounded-full bg-lime" /> : null}
                </span>
                <span className="text-sm font-semibold text-white">{option.name}</span>
                <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted">
                  {option.tag}
                </span>
                {active ? (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase">
                    <CheckIcon width={9} height={9} /> active
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 pl-6 text-xs leading-relaxed text-muted">{option.description}</p>
            </button>
          );
        })}
      </div>

      {provider !== "demo" ? (
        <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
          <h2 className="text-sm font-semibold text-white">Connection</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className={LABEL} htmlFor="base-url">
                Local server URL
              </label>
              <input
                id="base-url"
                className={`${FIELD} font-mono text-[12px]`}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:11434/v1"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="model">
                Model
              </label>
              <input
                id="model"
                className={`${FIELD} font-mono text-[12px]`}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="llama3.2"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MODELS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setModel(option)}
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition ${
                      model === option
                        ? "border-lime/50 bg-lime/10 text-lime"
                        : "border-line text-muted hover:text-white"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={LABEL} htmlFor="api-key">
                API key <span className="text-muted/60 normal-case">optional — most local servers don&apos;t need one</span>
              </label>
              <input
                id="api-key"
                type="password"
                className={`${FIELD} font-mono text-[12px]`}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  if (event.target.value) setClearApiKey(false);
                }}
                placeholder={
                  keyFromEnv
                    ? "Set by LLM_API_KEY in the environment"
                    : keySaved
                      ? "Key saved — leave blank to keep it"
                      : "sk-local-…"
                }
                disabled={keyFromEnv}
                autoComplete="off"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                {keyFromEnv ? (
                  <span>
                    Using the key from the <span className="font-mono text-white/70">LLM_API_KEY</span> environment
                    variable. It overrides anything saved here.
                  </span>
                ) : clearApiKey ? (
                  <>
                    <span className="text-amber-200">The saved key will be removed when you save.</span>
                    <button
                      type="button"
                      onClick={() => setClearApiKey(false)}
                      className="rounded-lg border border-line px-2 py-0.5 text-white transition hover:border-white/25"
                    >
                      Keep key
                    </button>
                  </>
                ) : hasApiKey ? (
                  <>
                    <span className="text-lime">A key is saved on this machine. It is never shown again.</span>
                    <button
                      type="button"
                      onClick={() => {
                        setClearApiKey(true);
                        setApiKey("");
                      }}
                      className="rounded-lg border border-line px-2 py-0.5 text-white transition hover:border-red-300/50 hover:text-red-200"
                    >
                      Remove key
                    </button>
                  </>
                ) : (
                  <span>No key saved.</span>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
        <h2 className="text-sm font-semibold text-white">Conversation defaults</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="user-name">
              What should bots call you?
            </label>
            <input
              id="user-name"
              className={FIELD}
              value={userName}
              maxLength={40}
              onChange={(event) => setUserName(event.target.value)}
              placeholder="Your name or handle"
            />
          </div>
          <div>
            <span className={LABEL}>Temperature · {temperature.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="mt-3 w-full cursor-pointer accent-[#c9f954]"
            />
            <p className="mt-1 text-[10px] text-muted/70">Used unless a bot defines its own temperature.</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft disabled:opacity-60"
        >
          <BoltIcon width={15} height={15} /> {saving ? "Saving…" : "Save runtime"}
        </button>
        <button
          type="button"
          onClick={test}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm text-white transition hover:border-white/25 disabled:opacity-60"
        >
          <SparkIcon width={15} height={15} /> {testing ? "Testing…" : "Test connection"}
        </button>
        {savedAt ? <span className="text-[11px] text-lime">Saved at {savedAt}</span> : null}
        {error ? <span className="text-[11px] text-red-300">{error}</span> : null}
      </div>

      {result ? (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
            result.ok
              ? "border-lime/30 bg-lime/[0.07] text-lime"
              : "border-red-400/30 bg-red-500/10 text-red-200"
          }`}
        >
          {result.ok ? <CheckIcon width={14} height={14} /> : <CloseIcon width={14} height={14} />}
          <span className="leading-relaxed">{result.detail}</span>
        </div>
      ) : null}

      <p className="flex items-start gap-2 rounded-xl border border-line/70 bg-panel/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted">
        <ShieldIcon width={14} height={14} className="mt-0.5 shrink-0 text-lime/80" />
        Requests go straight from this Next.js server to the URL above. No analytics, no proxy, no third-party
        endpoint — and if the model is offline, bots fall back to the built-in engine instead of erroring.
      </p>
    </div>
  );
}
