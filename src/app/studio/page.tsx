import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { BotStudioForm } from "@/components/BotStudioForm";
import { EditIcon, ShieldIcon, SparkIcon } from "@/components/Icons";
import { listBots } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const bots = await listBots();

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase">Studio</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Build a companion</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Give them a face, a temperament and a voice. Vesper wires the personality into every conversation —
            either through your local model or the built-in engine.
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-line bg-panel/60 px-3 py-1.5 text-[11px] text-muted">
          <ShieldIcon width={12} height={12} className="text-lime" />
          Local only · saved to your Postgres
        </div>
      </div>

      <div className="mt-6">
        <BotStudioForm mode="create" />
      </div>

      <section className="mt-10">
        <div className="mb-3 flex items-center gap-2">
          <SparkIcon width={14} height={14} className="text-lime" />
          <h2 className="text-sm font-semibold text-white">Edit a bot you already have</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <Link
              key={bot.id}
              href={`/studio/${bot.id}`}
              className="lift flex items-center gap-3 rounded-2xl border border-line/70 bg-panel/40 p-3 hover:border-lime/30"
            >
              <Avatar bot={bot} size={42} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{bot.name}</p>
                <p className="truncate text-[11px] text-muted">{bot.tagline || `@${bot.handle}`}</p>
              </div>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted">
                <EditIcon width={14} height={14} />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
