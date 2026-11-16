import { CodeBlock } from "@/components/CodeBlock";
import { BoltIcon, ChatIcon, ShieldIcon, SparkIcon } from "@/components/Icons";
import { RuntimeForm } from "@/components/RuntimeForm";
import { getRuntime, listBots, listConversations } from "@/lib/data";
import { runtimeBadge } from "@/lib/persona";

export const dynamic = "force-dynamic";

const OLLAMA_SETUP = `# 1. install Ollama (macOS / Linux)
curl -fsSL https://ollama.com/install.sh | sh

# 2. pull a small, chatty model
ollama pull llama3.2

# 3. the server starts automatically on :11434
curl http://127.0.0.1:11434/v1/models`;

const LM_STUDIO_SETUP = `1. Open LM Studio → Developer tab
2. Load a model (Qwen 2.5 7B is a great companion model)
3. Start the local server on port 1234
4. Use base URL  http://127.0.0.1:1234/v1
   model name     whatever LM Studio reports`;

export default async function RuntimePage() {
  const [runtime, bots, chats] = await Promise.all([getRuntime(), listBots(), listConversations()]);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase">Runtime</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Where the brains live</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Vesper is the app; the model is yours. Run the built-in engine for instant local replies, or plug in
            Ollama / LM Studio for full open-weight intelligence.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-panel/60 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
            </span>
            <span className="font-medium text-white">{runtimeBadge(runtime.provider)}</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted">
            {runtime.provider === "demo" ? "vesper-local-1" : runtime.model} · {bots.length} bots · {chats.length} chats
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <RuntimeForm initial={runtime} />
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <div className="flex items-center gap-2">
              <BoltIcon width={15} height={15} className="text-lime" />
              <h2 className="text-sm font-semibold text-white">Ollama quick start</h2>
            </div>
            <p className="mt-1 text-[11px] text-muted">One install, then Vesper can use it forever.</p>
            <div className="mt-3">
              <CodeBlock code={OLLAMA_SETUP} label="terminal" />
            </div>
          </section>

          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <div className="flex items-center gap-2">
              <SparkIcon width={15} height={15} className="text-violet" />
              <h2 className="text-sm font-semibold text-white">LM Studio / llama.cpp</h2>
            </div>
            <p className="mt-1 text-[11px] text-muted">Anything with an OpenAI-compatible endpoint works.</p>
            <div className="mt-3">
              <CodeBlock code={LM_STUDIO_SETUP} label="local server" />
            </div>
          </section>

          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <div className="flex items-center gap-2">
              <ChatIcon width={15} height={15} className="text-lime" />
              <h2 className="text-sm font-semibold text-white">How a reply is built</h2>
            </div>
            <ol className="mt-3 space-y-2.5 text-[11.5px] leading-relaxed text-muted">
              {[
                "Your message is stored locally, then the bot's persona, dials, tags and the last 12 turns are packed into a system prompt.",
                "If a local server is configured, Vesper sends it straight to that endpoint with the bot's temperature.",
                "If the server is unreachable, the built-in engine answers in character so the conversation never breaks.",
                "The transcript is saved to Postgres — fully editable, exportable, and yours.",
              ].map((step, index) => (
                <li key={index} className="flex gap-2.5">
                  <span className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full border border-lime/30 bg-lime/10 font-mono text-[9px] text-lime">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl border border-lime/20 bg-lime/[0.04] p-5">
            <div className="flex items-center gap-2">
              <ShieldIcon width={15} height={15} className="text-lime" />
              <h2 className="text-sm font-semibold text-white">Local means local</h2>
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-white/60">
              There is no account, no telemetry and no shared cloud. Bots, avatars and transcripts live in the
              Postgres instance on this machine. Treat the runtime panel like a settings file — if you switch to
              a hosted endpoint, that endpoint sees the prompts.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
