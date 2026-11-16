import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { BotCard } from "@/components/BotCard";
import { DeleteConversationButton } from "@/components/DeleteConversationButton";
import { ChatIcon, SparkIcon } from "@/components/Icons";
import { StartChatButton } from "@/components/StartChatButton";
import { listBots, listConversations } from "@/lib/data";
import { timeAgo, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const [chats, bots] = await Promise.all([listConversations(), listBots()]);
  const totalMessages = chats.reduce((sum, chat) => sum + chat.messageCount, 0);
  const suggestions = bots.filter((bot) => !chats.some((chat) => chat.botId === bot.id)).slice(0, 2);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 lg:px-10 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase">Transcripts</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Your chats</h1>
          <p className="mt-1 text-sm text-muted">
            {chats.length} thread{chats.length === 1 ? "" : "s"} · {totalMessages} messages, all stored locally.
          </p>
        </div>
        {bots[0] ? (
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-xs text-muted transition hover:text-white"
            >
              Browse roster
            </Link>
            <StartChatButton
              botId={bots[0].id}
              label={`Chat with ${bots[0].name}`}
              className="w-auto [&>button]:py-2 [&>button]:text-xs"
            />
          </div>
        ) : null}
      </div>

      {chats.length ? (
        <div className="mt-6 space-y-2.5">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className="lift flex items-center gap-3 rounded-2xl border border-line/70 bg-panel/40 p-3 sm:gap-4 sm:p-3.5"
            >
              <Link href={`/bots/${chat.bot.handle}`} className="shrink-0">
                <Avatar bot={chat.bot} size={46} online />
              </Link>
              <Link href={`/chats/${chat.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-white">{chat.title}</p>
                  <span className="hidden shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] text-muted sm:inline">
                    {chat.bot.name}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {chat.lastMessage ? truncate(chat.lastMessage, 120) : "No messages yet"}
                </p>
                <p className="mt-1 text-[10px] text-muted/60">
                  {timeAgo(chat.updatedAt)} · {chat.messageCount} message{chat.messageCount === 1 ? "" : "s"}
                </p>
              </Link>
              <DeleteConversationButton id={chat.id} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-3xl border border-dashed border-line bg-panel/30 p-8 text-center sm:p-12">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line bg-white/[0.03] text-lime">
            <ChatIcon width={24} height={24} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-white">No conversations yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Pick a companion and say something strange. Transcripts appear here automatically.
          </p>
          {bots[0] ? (
            <div className="mx-auto mt-4 w-56">
              <StartChatButton botId={bots[0].id} label={`Say hi to ${bots[0].name}`} />
            </div>
          ) : null}
        </div>
      )}

      {suggestions.length ? (
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <SparkIcon width={14} height={14} className="text-lime" />
            <h2 className="text-sm font-semibold text-white">You haven&apos;t met these yet</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {suggestions.map((bot) => (
              <BotCard key={bot.id} bot={bot} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
