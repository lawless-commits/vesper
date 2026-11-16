import Link from "next/link";
import { CodeBlock } from "@/components/CodeBlock";
import {
  ArrowRightIcon,
  BoltIcon,
  CheckIcon,
  ChatIcon,
  CloseIcon,
  ShieldIcon,
  SparkIcon,
} from "@/components/Icons";
import { autopilotSnapshot } from "@/lib/autopilot";
import { API_SURFACE, CAPABILITIES, EXTENSIONS, LIMITS } from "@/lib/capabilities";
import { getRuntime, listBots, listConversations } from "@/lib/data";

export const dynamic = "force-dynamic";

const STATUS_STYLE = {
  live: {
    label: "live",
    badge: "border-lime/40 bg-lime/10 text-lime",
    dot: "bg-lime",
    icon: "check",
  },
  partial: {
    label: "partial",
    badge: "border-amber-300/40 bg-amber-300/10 text-amber-200",
    dot: "bg-amber-300",
    icon: "half",
  },
  absent: {
    label: "not yet",
    badge: "border-line bg-white/[0.03] text-muted",
    dot: "bg-muted/50",
    icon: "x",
  },
} as const;

export default async function CapabilitiesPage() {
  const [bots, chats, runtime, autopilot] = await Promise.all([
    listBots(),
    listConversations(),
    getRuntime(),
    autopilotSnapshot(),
  ]);

  const live = CAPABILITIES.filter((item) => item.status === "live").length;
  const partial = CAPABILITIES.filter((item) => item.status === "partial").length;
  const absent = CAPABILITIES.filter((item) => item.status === "absent").length;
  const totalMessages = chats.reduce((sum, chat) => sum + chat.messageCount, 0);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase">Reference</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">What these bots can do</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            A straight answer, including what is deliberately missing. Every item below is checked against this
            instance, not a roadmap.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-panel/60 px-4 py-2.5">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted uppercase">This instance</p>
          <p className="mt-0.5 font-mono text-[11px] text-white/85">
            {bots.length} bots · {chats.length} chats · {totalMessages} messages
          </p>
          <p className="font-mono text-[10px] text-muted">
            engine {runtime.provider === "demo" ? "built-in" : runtime.model} · {autopilot.stats.enabled} armed
          </p>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Working now", value: String(live), tone: "text-lime", icon: CheckIcon },
          { label: "Partial", value: String(partial), tone: "text-amber-200", icon: SparkIcon },
          { label: "Not built", value: String(absent), tone: "text-muted", icon: CloseIcon },
          { label: "Data leaves device", value: "None", tone: "text-lime", icon: ShieldIcon },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl border border-line/70 bg-panel/40 px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
                <Icon width={11} height={11} /> {stat.label}
              </div>
              <p className={`mt-1 text-lg font-semibold ${stat.tone}`}>{stat.value}</p>
            </div>
          );
        })}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight text-white">Capability matrix</h2>
        <p className="text-xs text-muted">
          Personality, local inference, storage and scheduling are real. Anything touching the outside world is not.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {CAPABILITIES.map((capability) => {
            const style = STATUS_STYLE[capability.status];
            return (
              <article
                key={capability.id}
                className="lift rounded-2xl border border-line/70 bg-panel/40 p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-[15px] ${
                      capability.status === "live"
                        ? "border-lime/30 bg-lime/[0.08] text-lime"
                        : capability.status === "partial"
                          ? "border-amber-300/25 bg-amber-300/[0.06] text-amber-200"
                          : "border-line bg-white/[0.03] text-muted"
                    }`}
                  >
                    {capability.glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{capability.title}</h3>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${style.badge}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-white/70">{capability.summary}</p>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{capability.detail}</p>
                    <Link
                      href={capability.where.href}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted transition hover:text-lime"
                    >
                      {capability.where.label} <ArrowRightIcon width={11} height={11} />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-line/70 bg-panel/40 p-5">
          <div className="flex items-center gap-2">
            <ShieldIcon width={15} height={15} className="text-amber-200" />
            <h2 className="text-sm font-semibold text-white">Limits worth knowing</h2>
          </div>
          <ul className="mt-3 space-y-3">
            {LIMITS.map((limit) => (
              <li key={limit.title} className="rounded-xl border border-line/60 bg-ink/40 px-3 py-2.5">
                <p className="text-[12px] font-medium text-white/85">{limit.title}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{limit.body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-line/70 bg-panel/40 p-5">
          <div className="flex items-center gap-2">
            <ChatIcon width={15} height={15} className="text-lime" />
            <h2 className="text-sm font-semibold text-white">API surface</h2>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Everything the UI does is a documented local endpoint — script it, cron it, or build on it.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-line/60">
            {API_SURFACE.map((row, index) => (
              <div
                key={`${row.method}-${row.path}`}
                className={`flex flex-wrap items-center gap-2 px-3 py-2 text-[11px] ${
                  index % 2 === 0 ? "bg-white/[0.02]" : ""
                }`}
              >
                <span className="w-20 shrink-0 font-mono text-[9px] tracking-wider text-lime">{row.method}</span>
                <span className="font-mono text-[10.5px] text-white/80">{row.path}</span>
                <span className="ml-auto text-right text-[10px] text-muted">{row.what}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="extend" className="mt-10 scroll-mt-6">
        <div className="flex items-center gap-2">
          <BoltIcon width={16} height={16} className="text-lime" />
          <h2 className="text-lg font-semibold tracking-tight text-white">Extending toward real automation</h2>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          The honest gap between “runs by itself” and “does things in the world” is tool execution. These are the
          smallest safe steps, in the order I&apos;d take them.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {EXTENSIONS.map((extension) => (
            <div key={extension.id} className="rounded-2xl border border-line/70 bg-panel/40 p-4">
              <h3 className="text-sm font-semibold text-white">{extension.title}</h3>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{extension.body}</p>
              <div className="mt-2.5">
                <CodeBlock code={extension.code} label="sketch" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-10 flex flex-col gap-2 border-t border-line/70 pt-5 text-[11px] leading-relaxed text-muted/70 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Bots read and write only your local Postgres. If you point the runtime at a remote endpoint, that endpoint
          sees your prompts — that is the one real data boundary to watch.
        </p>
        <Link href="/runtime" className="flex shrink-0 items-center gap-1 transition hover:text-lime">
          Check the runtime <ArrowRightIcon width={11} height={11} />
        </Link>
      </footer>
    </div>
  );
}
