"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import {
  BoltIcon,
  ChatIcon,
  CloseIcon,
  CompassIcon,
  MenuIcon,
  PlusIcon,
  ShieldIcon,
  SlidersIcon,
  WandIcon,
} from "@/components/Icons";
import type { BotView, RuntimeView } from "@/lib/types";

const NAV = [
  { href: "/", label: "Discover", icon: CompassIcon },
  { href: "/chats", label: "Your chats", icon: ChatIcon },
  { href: "/autopilot", label: "Autopilot", icon: BoltIcon },
  { href: "/studio", label: "Bot studio", icon: WandIcon },
  { href: "/runtime", label: "Runtime", icon: SlidersIcon },
  { href: "/capabilities", label: "Capabilities", icon: ShieldIcon },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-3">
      <span className="relative grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-lime to-[#6ee7b7] text-ink shadow-[0_14px_30px_-12px_rgba(201,249,84,0.8)]">
        <span className="text-[17px] font-black tracking-tighter">V</span>
        <span className="absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full border-2 border-ink bg-violet" />
      </span>
      <span className="leading-none">
        <span className="block text-[17px] font-semibold tracking-[0.18em] text-white">VESPER</span>
        <span className="mt-1 block text-[10px] tracking-[0.22em] text-muted uppercase">Local companion studio</span>
      </span>
    </Link>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
              active
                ? "bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-muted hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            <Icon
              width={18}
              height={18}
              className={active ? "text-lime" : "text-muted group-hover:text-white/80"}
            />
            <span className="font-medium">{item.label}</span>
            {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-lime" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [bots, setBots] = useState<BotView[]>([]);
  const [runtime, setRuntime] = useState<RuntimeView | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/bots")
      .then((res) => res.json())
      .then((data: { bots?: BotView[] }) => {
        if (!cancelled) setBots(data.bots ?? []);
      })
      .catch(() => undefined);
    fetch("/api/runtime")
      .then((res) => res.json())
      .then((data: { runtime?: RuntimeView }) => {
        if (!cancelled) setRuntime(data.runtime ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const providerLabel =
    runtime?.provider === "ollama"
      ? `Ollama · ${runtime.model}`
      : runtime?.provider === "openai"
        ? `Local API · ${runtime.model}`
        : "Built-in engine";

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-5">
      <div className="flex items-center justify-between">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted lg:hidden"
          aria-label="Close menu"
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>

      <Link
        href="/studio"
        onClick={() => setOpen(false)}
        className="flex items-center justify-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft"
      >
        <PlusIcon width={16} height={16} />
        Create a bot
      </Link>

      <NavList pathname={pathname} onNavigate={() => setOpen(false)} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.2em] text-muted/70 uppercase">
          In your roster
        </p>
        <div className="space-y-1">
          {bots.slice(0, 5).map((bot) => (
            <Link
              key={bot.id}
              href={`/bots/${bot.handle}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-muted transition hover:bg-white/[0.04] hover:text-white"
            >
              <Avatar bot={bot} size={26} glow={false} />
              <span className="truncate">{bot.name}</span>
              <span className="ml-auto font-mono text-[10px] text-muted/60">@{bot.handle}</span>
            </Link>
          ))}
          {!bots.length ? <p className="px-3 text-xs text-muted/70">Loading roster…</p> : null}
        </div>
      </div>

      <Link
        href="/runtime"
        onClick={() => setOpen(false)}
        className="rounded-2xl border border-line bg-panel/70 p-3 transition hover:border-line/80 hover:bg-panel"
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
          </span>
          <span className="font-medium text-white/90">Runtime ready</span>
          <BoltIcon width={13} height={13} className="ml-auto text-lime" />
        </div>
        <p className="mt-1.5 truncate text-[11px] text-muted">{providerLabel}</p>
        <p className="mt-2 text-[10px] text-muted/60">Runs on your machine. Nothing leaves it.</p>
      </Link>
    </div>
  );

  return (
    <div className="app-bg grain min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] border-r border-line/70 bg-ink/70 backdrop-blur-xl lg:block">
        {sidebar}
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line/70 bg-ink/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-xl border border-line text-white"
          aria-label="Open menu"
        >
          <MenuIcon width={18} height={18} />
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu overlay"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="animate-pop absolute inset-y-0 left-0 w-[290px] border-r border-line bg-ink">
            {sidebar}
          </div>
        </div>
      ) : null}

      <main className="lg:pl-[272px]">{children}</main>
    </div>
  );
}
