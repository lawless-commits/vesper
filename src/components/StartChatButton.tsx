"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChatIcon } from "@/components/Icons";

export function StartChatButton({
  botId,
  label = "Start chatting",
  prompt,
  variant = "primary",
  className = "",
}: {
  botId: number;
  label?: string;
  prompt?: string;
  variant?: "primary" | "ghost" | "outline";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const styles =
    variant === "primary"
      ? "bg-lime text-ink hover:bg-lime-soft"
      : variant === "outline"
        ? "border border-line bg-white/[0.03] text-white hover:border-lime/40 hover:bg-lime/[0.06]"
        : "text-muted hover:bg-white/[0.05] hover:text-white";

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId }),
      });
      const data = (await res.json()) as { conversation?: { id: number }; error?: string };
      if (!res.ok || !data.conversation) throw new Error(data.error ?? "Could not open a chat");
      const query = prompt ? `?say=${encodeURIComponent(prompt)}` : "";
      startTransition(() => {
        router.push(`/chats/${data.conversation!.id}${query}`);
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open a chat");
      setBusy(false);
    }
  }

  const loading = busy || pending;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={launch}
        disabled={loading}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-70 ${styles}`}
      >
        <ChatIcon width={16} height={16} />
        {loading ? "Opening chat…" : label}
      </button>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
