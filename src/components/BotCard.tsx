import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { ArrowRightIcon, SparkIcon } from "@/components/Icons";
import { accentAlpha } from "@/lib/avatar";
import type { BotView } from "@/lib/types";

export function BotCard({ bot, featured = false }: { bot: BotView; featured?: boolean }) {
  const accent = bot.accent || "#c9f954";
  return (
    <Link
      href={`/bots/${bot.handle}`}
      className={`lift group relative flex flex-col overflow-hidden rounded-3xl border border-line/80 bg-panel/60 ${
        featured ? "sm:flex-row sm:items-center sm:gap-5 p-4" : "p-4"
      }`}
      style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)` }}
    >
      <div
        className="pointer-events-none absolute -top-24 -right-16 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: accentAlpha(accent, 0.28) }}
      />
      <div className={`relative flex items-start gap-4 ${featured ? "sm:items-center" : ""}`}>
        <Avatar bot={bot} size={featured ? 86 : 58} online />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-white">{bot.name}</h3>
            {bot.featured ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-lime/25 bg-lime/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase">
                <SparkIcon width={9} height={9} /> featured
              </span>
            ) : null}
          </div>
          <p className="truncate font-mono text-[11px] text-muted">@{bot.handle}</p>
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-white/60">{bot.tagline}</p>
        </div>
      </div>
      <div className="relative mt-3 flex flex-wrap gap-1.5">
        {bot.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-line/80 bg-white/[0.03] px-2 py-0.5 text-[10px] text-muted"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="relative mt-3 flex items-center justify-between border-t border-line/60 pt-2.5">
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
          {bot.chatCount ? `${bot.chatCount} chat${bot.chatCount === 1 ? "" : "s"}` : "Ready to chat"}
        </span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-white/70 transition group-hover:text-white">
          Open <ArrowRightIcon width={13} height={13} />
        </span>
      </div>
    </Link>
  );
}

export function CreateBotCard() {
  return (
    <Link
      href="/studio"
      className="group flex min-h-[188px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-line bg-panel/30 p-6 text-center transition hover:border-lime/40 hover:bg-lime/[0.04]"
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/[0.03] text-muted transition group-hover:border-lime/40 group-hover:text-lime">
        <span className="text-xl leading-none">+</span>
      </span>
      <span className="text-sm font-semibold text-white">Make your own</span>
      <span className="max-w-[190px] text-xs leading-relaxed text-muted">
        Pick an avatar, dial in a personality, and give them a voice.
      </span>
    </Link>
  );
}
