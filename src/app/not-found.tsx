import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="font-mono text-xs tracking-[0.3em] text-lime uppercase">404 · signal lost</span>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">This bot isn&apos;t on the roster</h1>
      <p className="mt-2 text-sm text-muted">
        The companion or chat you were looking for may have been deleted, or the handle is wrong.
      </p>
      <div className="mt-6 flex gap-2">
        <Link
          href="/"
          className="rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft"
        >
          Back to discover
        </Link>
        <Link
          href="/studio"
          className="rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm text-white transition hover:border-white/25"
        >
          Build a new bot
        </Link>
      </div>
    </div>
  );
}
