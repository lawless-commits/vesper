import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { BotCard } from "@/components/BotCard";
import { DiscoverClient } from "@/components/DiscoverClient";
import {
  ArrowRightIcon,
  BoltIcon,
  ChatIcon,
  ShieldIcon,
  SparkIcon,
  WandIcon,
} from "@/components/Icons";
import { getRuntime, listBots, listConversations } from "@/lib/data";
import { runtimeBadge } from "@/lib/persona";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const [bots, chats, runtime] = await Promise.all([listBots(), listConversations(), getRuntime()]);
  const featured = bots.filter((bot) => bot.featured).slice(0, 3);
  const heroBots = (featured.length ? featured : bots.slice(0, 3)).slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase">Discover</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">The roster</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1.5 text-[11px] text-muted sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-lime" />
            {runtimeBadge(runtime.provider)}
          </span>
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 rounded-xl bg-lime px-4 py-2 text-sm font-semibold text-ink transition hover:bg-lime-soft"
          >
            <WandIcon width={15} height={15} />
            Create a bot
          </Link>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-[28px] border border-line/80 bg-gradient-to-br from-panel-2/90 via-panel/60 to-ink p-6 sm:p-9">
        <div className="pointer-events-none absolute -top-32 -left-24 h-72 w-72 rounded-full bg-lime/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-violet/10 blur-3xl" />
        <div className="relative grid items-center gap-9 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-lime/25 bg-lime/[0.08] px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-lime uppercase">
              <SparkIcon width={11} height={11} /> Local-first companion studio
            </span>
            <h2 className="mt-4 text-[34px] leading-[1.05] font-semibold tracking-tight text-white sm:text-[46px]">
              Your own bots.
              <br />
              <span className="text-lime">Your own machine.</span>
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/60 sm:text-[15px]">
              Design a character with an avatar, a personality and a voice — then chat with them the way you
              would with any big-name AI. Everything is stored on this device, and every reply can run on your
              own local model.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Link
                href="/studio"
                className="inline-flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft"
              >
                <WandIcon width={16} height={16} /> Design a companion
              </Link>
              {bots[0] ? (
                <Link
                  href={`/bots/${bots[0].handle}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.06]"
                >
                  <ChatIcon width={16} height={16} /> Meet {bots[0].name}
                </Link>
              ) : null}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted">
              <ShieldIcon width={13} height={13} className="text-lime/80" />
              No accounts. No cloud calls. Nothing to subscribe to.
            </p>
          </div>

          <div className="relative mx-auto grid w-full max-w-sm grid-cols-2 gap-3">
            {heroBots[0] ? (
              <div className="animate-float col-span-2 flex items-center gap-3 rounded-2xl border border-line/90 bg-ink/70 p-3 backdrop-blur-sm">
                <Avatar bot={heroBots[0]} size={62} online />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{heroBots[0].name}</p>
                  <p className="line-clamp-2 text-[11px] leading-snug text-muted">{heroBots[0].tagline}</p>
                </div>
              </div>
            ) : null}
            {heroBots.slice(1, 3).map((bot) => (
              <div key={bot.id} className="rounded-2xl border border-line/90 bg-ink/70 p-3">
                <Avatar bot={bot} size={44} />
                <p className="mt-2 truncate text-xs font-semibold text-white">{bot.name}</p>
                <p className="truncate font-mono text-[10px] text-muted">@{bot.handle}</p>
              </div>
            ))}
            <div className="col-span-2 flex items-center justify-between rounded-2xl border border-line/90 bg-ink/70 px-3 py-2.5">
              <div className="flex -space-x-2">
                {bots.slice(0, 5).map((bot) => (
                  <Avatar key={bot.id} bot={bot} size={26} glow={false} />
                ))}
              </div>
              <span className="text-[11px] text-muted">{bots.length} companions ready</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Companions", value: String(bots.length), icon: SparkIcon, hint: "in your roster" },
          { label: "Saved chats", value: String(chats.length), icon: ChatIcon, hint: "stored locally" },
          {
            label: "Engine",
            value: runtime.provider === "demo" ? "Vesper local" : runtime.model,
            icon: BoltIcon,
            hint: runtime.provider === "demo" ? "no setup needed" : "your machine",
          },
          { label: "Privacy", value: "100% local", icon: ShieldIcon, hint: "nothing leaves" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="rounded-2xl border border-line/70 bg-panel/40 px-4 py-3.5"
            >
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-muted uppercase">
                <Icon width={12} height={12} /> {stat.label}
              </div>
              <p className="mt-1.5 truncate text-lg font-semibold text-white">{stat.value}</p>
              <p className="text-[11px] text-muted/80">{stat.hint}</p>
            </div>
          );
        })}
      </section>

      {featured.length ? (
        <section className="mt-10">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-white">Featured companions</h2>
              <p className="text-xs text-muted">Hand-built personalities. Each one is fully editable.</p>
            </div>
            <Link href="/studio" className="flex items-center gap-1 text-xs text-muted transition hover:text-white">
              Make one like this <ArrowRightIcon width={13} height={13} />
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((bot) => (
              <BotCard key={bot.id} bot={bot} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-white">Everyone in the roster</h2>
            <p className="text-xs text-muted">Filter by vibe, or search for a name and start talking.</p>
          </div>
        </div>
        <DiscoverClient bots={bots} />
      </section>

      <footer className="mt-12 flex flex-col gap-2 border-t border-line/70 pt-5 text-[11px] text-muted/70 sm:flex-row sm:items-center sm:justify-between">
        <p>Vesper runs on your machine. Bots and transcripts live in your local Postgres.</p>
        <span className="flex items-center gap-3">
          <Link href="/capabilities" className="flex items-center gap-1 text-muted transition hover:text-lime">
            What bots can do <ArrowRightIcon width={12} height={12} />
          </Link>
          <Link href="/runtime" className="flex items-center gap-1 text-muted transition hover:text-lime">
            Connect Ollama or LM Studio <ArrowRightIcon width={12} height={12} />
          </Link>
        </span>
      </footer>
    </div>
  );
}
