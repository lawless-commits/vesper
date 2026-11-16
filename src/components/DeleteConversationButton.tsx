"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@/components/Icons";

export function DeleteConversationButton({ id, label = "Delete chat" }: { id: number; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  async function remove() {
    if (!window.confirm("Delete this chat and its messages? This can't be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setHidden(true);
      router.refresh();
    } catch {
      setBusy(false);
      window.alert("Couldn't delete that chat. Try again.");
    }
  }

  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line/70 bg-white/[0.02] text-muted transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"
    >
      <TrashIcon width={14} height={14} />
    </button>
  );
}
