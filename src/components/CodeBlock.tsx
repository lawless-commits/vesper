"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/Icons";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line/80 bg-ink/80">
      <div className="flex items-center justify-between border-b border-line/70 px-3 py-1.5">
        <span className="font-mono text-[10px] tracking-wider text-muted uppercase">{label ?? "shell"}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-muted transition hover:text-lime"
        >
          {copied ? <CheckIcon width={11} height={11} /> : <CopyIcon width={11} height={11} />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-white/70">
        {code}
      </pre>
    </div>
  );
}
