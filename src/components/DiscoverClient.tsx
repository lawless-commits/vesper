"use client";

import { useMemo, useState } from "react";
import { BotCard, CreateBotCard } from "@/components/BotCard";
import { SearchIcon } from "@/components/Icons";
import type { BotView } from "@/lib/types";

export function DiscoverClient({ bots }: { bots: BotView[] }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string>("all");

  const tags = useMemo(() => {
    const set = new Set<string>();
    bots.forEach((bot) => bot.tags.forEach((t) => set.add(t)));
    return ["all", ...Array.from(set).sort()];
  }, [bots]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bots.filter((bot) => {
      const matchesTag = tag === "all" || bot.tags.includes(tag);
      if (!matchesTag) return false;
      if (!q) return true;
      return (
        bot.name.toLowerCase().includes(q) ||
        bot.handle.toLowerCase().includes(q) ||
        bot.tagline.toLowerCase().includes(q) ||
        bot.tags.some((t) => t.includes(q))
      );
    });
  }, [bots, query, tag]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTag(item)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                tag === item
                  ? "border-lime/50 bg-lime/15 text-lime"
                  : "border-line bg-white/[0.02] text-muted hover:border-line/80 hover:text-white"
              }`}
            >
              {item === "all" ? "All bots" : item}
            </button>
          ))}
        </div>
        <label className="relative flex items-center sm:w-64">
          <SearchIcon width={16} height={16} className="pointer-events-none absolute left-3 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the roster"
            className="w-full rounded-xl border border-line bg-panel/70 py-2 pr-3 pl-9 text-sm text-white placeholder:text-muted/60 focus:border-lime/50 focus:ring-2 focus:ring-lime/15 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((bot) => (
          <BotCard key={bot.id} bot={bot} />
        ))}
        <CreateBotCard />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-line/70 bg-panel/40 p-8 text-center">
          <p className="text-sm font-medium text-white">Nothing matches “{query || tag}” yet.</p>
          <p className="mt-1 text-xs text-muted">Try a broader search, or build exactly the bot you&apos;re looking for.</p>
        </div>
      ) : null}
    </div>
  );
}
