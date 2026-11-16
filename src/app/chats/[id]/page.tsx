import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { ChatView } from "@/components/ChatView";
import { BackIcon, PlusIcon } from "@/components/Icons";
import { StartChatButton } from "@/components/StartChatButton";
import { getConversation, getRuntime, listConversations } from "@/lib/data";
import { parseId } from "@/lib/http";
import { runtimeBadge } from "@/lib/persona";
import { timeAgo, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ say?: string }>;
}) {
  const [{ id }, { say }] = await Promise.all([params, searchParams]);
  const numericId = parseId(id);
  if (numericId === null) notFound();

  const result = await getConversation(numericId);
  if (!result) notFound();

  const { conversation, messages } = result;
  const [chats, runtime] = await Promise.all([
    listConversations(conversation.botId),
    getRuntime(),
  ]);

  return (
    <div className="flex h-[calc(100dvh-65px)] min-h-0 lg:h-dvh">
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-line/70 bg-ink/40 lg:flex">
        <div className="border-b border-line/70 p-4">
          <Link href="/chats" className="inline-flex items-center gap-1.5 text-[11px] text-muted hover:text-white">
            <BackIcon width={12} height={12} /> All chats
          </Link>
          <Link href={`/bots/${conversation.bot.handle}`} className="mt-3 flex items-center gap-2.5">
            <Avatar bot={conversation.bot} size={38} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{conversation.bot.name}</p>
              <p className="truncate font-mono text-[10px] text-muted">@{conversation.bot.handle}</p>
            </div>
          </Link>
          <StartChatButton
            botId={conversation.bot.id}
            label="New chat"
            variant="outline"
            className="mt-3 [&>button]:py-2 [&>button]:text-xs"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="px-2 py-2 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">
            Threads · {chats.length}
          </p>
          <div className="space-y-1">
            {chats.map((chat) => {
              const active = chat.id === conversation.id;
              return (
                <Link
                  key={chat.id}
                  href={`/chats/${chat.id}`}
                  className={`block rounded-xl px-2.5 py-2.5 transition ${
                    active
                      ? "border border-lime/25 bg-lime/[0.07]"
                      : "border border-transparent hover:bg-white/[0.04]"
                  }`}
                >
                  <p className={`truncate text-xs ${active ? "font-medium text-white" : "text-white/75"}`}>
                    {chat.title}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted">
                    {timeAgo(chat.updatedAt)} · {chat.messageCount} msg
                  </p>
                  {chat.lastMessage ? (
                    <p className="mt-1 line-clamp-1 text-[10px] text-muted/70">
                      {truncate(chat.lastMessage, 62)}
                    </p>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="border-t border-line/70 p-3">
          <Link
            href="/studio"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[11px] text-muted transition hover:border-lime/30 hover:text-lime"
          >
            <PlusIcon width={12} height={12} /> Design a new bot
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <ChatView
          conversation={conversation}
          initialMessages={messages}
          starters={conversation.bot.starters}
          initialPrompt={say}
          runtimeLabel={runtimeBadge(runtime.provider)}
          userName={runtime.userName || "You"}
        />
      </div>
    </div>
  );
}
