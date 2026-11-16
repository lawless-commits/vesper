import Link from "next/link";
import { notFound } from "next/navigation";
import { BotStudioForm } from "@/components/BotStudioForm";
import { BackIcon } from "@/components/Icons";
import { getBotById } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function EditBotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();
  const bot = await getBotById(numericId);
  if (!bot) notFound();

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10">
      <Link
        href={`/bots/${bot.handle}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-white"
      >
        <BackIcon width={13} height={13} /> Back to {bot.name}
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase">Studio · editing</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{bot.name}</h1>
          <p className="mt-1 text-sm text-muted">Changes apply to the next message. Existing chats stay untouched.</p>
        </div>
        <span className="font-mono text-[11px] text-muted">@{bot.handle}</span>
      </div>

      <div className="mt-6">
        <BotStudioForm mode="edit" bot={bot} />
      </div>
    </div>
  );
}
