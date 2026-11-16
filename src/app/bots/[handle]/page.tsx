import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BackIcon, ChatIcon, EditIcon, SparkIcon } from "@/components/Icons";
import { StartChatButton } from "@/components/StartChatButton";
import { accentAlpha } from "@/lib/avatar";
import { listRuns } from "@/lib/autopilot";
import { getBotByHandle, getRuntime, listConversations } from "@/lib/data";
import { runtimeBadge } from "@/lib/persona";
import { timeAgo, traitLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TRAITS = [
  { key: "warmth" as const, label: "Warmth", low: "detached", high: "devoted", color: "#f9a8d4" },
  { key: "chaos" as const, label: "Chaos", low: "steady", high: "unhinged", color: "#c9f954" },
  { key: "wit" as const, label: "Wit", low: "plain-spoken", high: "razor-sharp", color: "#7dd3fc" },
];

export default async function BotProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const bot = await getBotByHandle(handle);
  if (!bot) notFound();

  const [chats, runtime, runs] = await Promise.all([
    listConversations(bot.id),
    getRuntime(),
    listRuns(30),
  ]);
  const transmissions = runs.filter((run) => run.botId === bot.id).slice(0, 3);
  const accent = bot.accent || "#c9f954";

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 lg:px-10 lg:py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-white"
      >
        <BackIcon width={13} height={13} /> Back to the roster
      </Link>

      <div className="relative mt-4 overflow-hidden rounded-[28px] border border-line/80 bg-panel/50">
        <div
          className="h-28 w-full sm:h-32"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), radial-gradient(90% 170% at 16% 0%, rgba(255,255,255,0.13) 0%, transparent 62%), linear-gradient(120deg, #191c20, #08090b)`,
            backgroundSize: "34px 34px, 34px 34px, auto, auto",
          }}
        />
        <div className="relative -mt-12 px-5 pb-6 sm:px-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <Avatar bot={bot} size={104} online className="animate-pop border-2 border-ink" />
              <div className="pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-white">{bot.name}</h1>
                  {bot.featured ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-lime/25 bg-lime/10 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase">
                      <SparkIcon width={9} height={9} /> featured
                    </span>
                  ) : null}
                </div>
                <p className="font-mono text-xs text-muted">@{bot.handle}</p>
                <p className="mt-1 text-sm text-white/60">{bot.tagline}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Link
                href={`/studio/${bot.id}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white/[0.03] px-3 py-2 text-xs font-medium text-white transition hover:border-white/25"
              >
                <EditIcon width={14} height={14} /> Edit
              </Link>
              <StartChatButton botId={bot.id} label="Start chatting" className="w-auto min-w-[150px]" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {bot.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border px-2.5 py-1 text-[11px]"
                style={{
                  borderColor: accentAlpha(accent, 0.3),
                  background: accentAlpha(accent, 0.08),
                  color: accentAlpha(accent, 0.95),
                }}
              >
                {tag}
              </span>
            ))}
            <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted">
              {bot.visibility}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_330px]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">About</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-white/75">
              {bot.bio || `${bot.name} hasn't written a bio yet. It's all instinct.`}
            </p>
          </section>

          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Opening line</h2>
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-line/70 bg-ink/60 p-3.5">
              <Avatar bot={bot} size={38} glow={false} />
              <p className="text-sm leading-relaxed text-white/85">{bot.greeting}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">
              Good ways to break the ice
            </h2>
            <div className="mt-3 space-y-2">
              {bot.starters.map((starter) => (
                <div
                  key={starter}
                  className="flex flex-col gap-2 rounded-xl border border-line/70 bg-white/[0.02] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="text-sm text-white/80">“{starter}”</p>
                  <StartChatButton
                    botId={bot.id}
                    label="Send this"
                    prompt={starter}
                    variant="outline"
                    className="w-auto shrink-0 [&>button]:px-3 [&>button]:py-1.5 [&>button]:text-[11px]"
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">
              System prompt · how {bot.name} thinks
            </h2>
            <pre className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-line/70 bg-ink/70 p-3.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-white/60">
              {bot.persona}
            </pre>
          </section>

          {transmissions.length ? (
            <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">
                  Autonomous transmissions
                </h2>
                <Link href="/autopilot" className="text-[11px] text-muted hover:text-white">
                  Autopilot
                </Link>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                Things {bot.name} posted while you weren&apos;t around.
              </p>
              <div className="mt-3 space-y-2">
                {transmissions.map((run) => (
                  <div key={run.id} className="rounded-xl border border-line/60 bg-ink/50 px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] tracking-wider text-muted uppercase">
                        {run.kind}
                      </span>
                      <span className="text-[10px] text-muted/70">{timeAgo(run.createdAt)}</span>
                      {run.partnerName ? (
                        <span className="text-[10px] text-muted/70">with {run.partnerName}</span>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/75">{run.content}</p>
                    {run.status === "pending" ? (
                      <Link
                        href="/autopilot"
                        className="mt-1.5 inline-block text-[10px] text-amber-200 hover:text-amber-100"
                      >
                        waiting for approval →
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {chats.length ? (
            <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">
                  Your history with {bot.name}
                </h2>
                <Link href="/chats" className="text-[11px] text-muted hover:text-white">
                  All chats
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {chats.slice(0, 4).map((chat) => (
                  <Link
                    key={chat.id}
                    href={`/chats/${chat.id}`}
                    className="flex items-center gap-3 rounded-xl border border-line/60 bg-white/[0.02] px-3.5 py-2.5 transition hover:border-line hover:bg-white/[0.05]"
                  >
                    <ChatIcon width={15} height={15} className="shrink-0 text-muted" />
                    <p className="min-w-0 flex-1 truncate text-sm text-white/80">{chat.title}</p>
                    <span className="shrink-0 text-[11px] text-muted">{timeAgo(chat.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Personality</h2>
            <div className="mt-4 space-y-4">
              {TRAITS.map((trait) => {
                const value = bot[trait.key];
                return (
                  <div key={trait.key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/80">{trait.label}</span>
                      <span className="text-muted">
                        {traitLabel(value, trait.low, trait.high)} · {value}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${value}%`, background: trait.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
            <h2 className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Runtime</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              {[
                ["Engine", runtimeBadge(runtime.provider)],
                ["Model", runtime.provider === "demo" ? "vesper-local-1" : runtime.model],
                ["Temperature", bot.temperature.toFixed(2)],
                ["Creator", bot.creator],
                ["Chats", String(chats.length)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="truncate text-right text-white/80">{value}</dd>
                </div>
              ))}
            </dl>
            <Link
              href="/runtime"
              className="mt-4 block rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-center text-[11px] text-muted transition hover:border-lime/30 hover:text-lime"
            >
              Change the engine
            </Link>
          </section>

          <section
            className="rounded-2xl border p-5"
            style={{ borderColor: accentAlpha(accent, 0.25), background: accentAlpha(accent, 0.05) }}
          >
            <h2 className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: accent }}>
              Make it yours
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-white/65">
              Every word of {bot.name}&apos;s persona is editable. Fork the vibe, change the dials, swap the avatar
              — the next conversation picks it up immediately.
            </p>
            <Link
              href={`/studio/${bot.id}`}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-white hover:text-lime"
            >
              Open in studio <EditIcon width={13} height={13} />
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
