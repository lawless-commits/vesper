"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import {
  BackIcon,
  CheckIcon,
  CopyIcon,
  EditIcon,
  SendIcon,
  SparkIcon,
  VolumeIcon,
  VolumeOffIcon,
} from "@/components/Icons";
import type { ConversationView, MessageView } from "@/lib/types";

type ChatMessage = MessageView & { pending?: boolean; failed?: boolean };

function engineLabel(engine: string) {
  if (!engine || engine === "user") return "";
  if (engine === "vesper-local") return "built-in engine";
  if (engine.startsWith("ollama:")) return `ollama · ${engine.split(":")[1]}`;
  if (engine.startsWith("openai:")) return `local api · ${engine.split(":")[1]}`;
  return engine;
}

function MessageBubble({
  message,
  bot,
  userName,
  onSpeak,
}: {
  message: ChatMessage;
  bot: ConversationView["bot"];
  userName: string;
  onSpeak: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (isUser) {
    return (
      <div className="animate-rise flex justify-end gap-2.5">
        <div className="flex max-w-[85%] flex-col items-end">
          <div className="rounded-2xl rounded-br-md bg-lime px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-ink shadow-[0_10px_30px_-16px_rgba(201,249,84,0.8)]">
            {message.content}
          </div>
          <span className="mt-1 pr-1 text-[10px] text-muted">{userName}</span>
        </div>
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-panel-2 text-[11px] font-semibold text-white/80">
          {(userName || "Y").slice(0, 1).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div className="animate-rise flex gap-2.5">
      <Avatar bot={bot} size={34} glow={false} />
      <div className="group min-w-0 max-w-[86%]">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-white/90">{bot.name}</span>
          <span className="font-mono text-[10px] text-muted/80">{engineLabel(message.engine)}</span>
        </div>
        <div className="rounded-2xl rounded-tl-md border border-line/80 bg-panel/70 px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-white/85">
          {message.content}
          {message.pending ? (
            <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-lime/70 align-middle" />
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2 pl-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1 text-[10px] text-muted transition hover:text-white"
          >
            {copied ? <CheckIcon width={11} height={11} /> : <CopyIcon width={11} height={11} />}
            {copied ? "copied" : "copy"}
          </button>
          <button
            type="button"
            onClick={() => onSpeak(message.content)}
            className="flex items-center gap-1 text-[10px] text-muted transition hover:text-white"
          >
            <VolumeIcon width={11} height={11} /> speak
          </button>
          <span className="text-[10px] text-muted/60">@{bot.handle}</span>
        </div>
      </div>
    </div>
  );
}

export function ChatView({
  conversation,
  initialMessages,
  starters,
  initialPrompt,
  runtimeLabel,
  userName,
}: {
  conversation: ConversationView;
  initialMessages: MessageView[];
  starters: string[];
  initialPrompt?: string;
  runtimeLabel: string;
  userName: string;
}) {
  const router = useRouter();
  const bot = conversation.bot;
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSent = useRef(false);
  const voiceRef = useRef(false);
  const [voiceOn, setVoiceOn] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("vesper:voice");
      if (stored === "on") {
        voiceRef.current = true;
        setVoiceOn(true);
      }
    } catch {
      // ignore storage restrictions
    }
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // ignore
      }
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const clean = text.replace(/\*[^*]{1,80}\*/g, "").replace(/\s+/g, " ").trim();
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean.slice(0, 900));
      utterance.rate = 0.9 + (bot.chaos / 100) * 0.18;
      utterance.pitch = 0.85 + (bot.warmth / 100) * 0.4;
      utterance.volume = 1;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((voice) => /en-(GB|US)/i.test(voice.lang));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    },
    [bot.chaos, bot.warmth],
  );

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    voiceRef.current = next;
    try {
      window.localStorage.setItem("vesper:voice", next ? "on" : "off");
    } catch {
      // ignore
    }
    if (!next) window.speechSynthesis?.cancel();
    else speak(`Voice on. I'm ${bot.name}. ${bot.tagline || ""}`);
  }

  const scrollToBottom = useCallback((smooth = true) => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages, sending, scrollToBottom]);

  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim();
      if (!content || sending) return;
      const tempId = -Date.now();
      const optimistic: ChatMessage = {
        id: tempId,
        role: "user",
        content,
        engine: "user",
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMessages((current) => [...current, optimistic]);
      setInput("");
      setSending(true);
      setError(null);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversation.id, content }),
        });
        const data = (await response.json()) as {
          userMessage?: MessageView;
          reply?: MessageView;
          notice?: string | null;
          error?: string;
        };
        if (!response.ok || !data.reply || !data.userMessage) {
          throw new Error(data.error ?? "The engine didn't answer.");
        }
        setMessages((current) => [
          ...current.filter((message) => message.id !== tempId),
          { ...data.userMessage!, pending: false },
          data.reply!,
        ]);
        if (data.notice) setNotice(data.notice);
        if (voiceRef.current) speak(data.reply.content);
        router.refresh();
      } catch (err) {
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId ? { ...message, pending: false, failed: true } : message,
          ),
        );
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setInput(content);
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
    },
    [conversation.id, router, sending, speak],
  );

  useEffect(() => {
    if (!initialPrompt || autoSent.current) return;
    autoSent.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void send(initialPrompt);
  }, [initialPrompt, send]);

  function resize() {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }

  const showStarters = messages.length <= 1 && !sending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line/70 bg-ink/60 px-4 py-3 backdrop-blur-xl sm:px-5">
        <Link
          href="/chats"
          className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-white lg:hidden"
          aria-label="Back to chats"
        >
          <BackIcon width={16} height={16} />
        </Link>
        <Link href={`/bots/${bot.handle}`} className="flex min-w-0 items-center gap-3">
          <Avatar bot={bot} size={42} online />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{bot.name}</p>
            <p className="truncate text-[11px] text-muted">
              {bot.tagline || `@${bot.handle}`}
            </p>
          </div>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-panel/60 px-2.5 py-1 text-[10px] text-muted sm:inline-flex">
            <SparkIcon width={10} height={10} className="text-lime" />
            {runtimeLabel}
          </span>
          <button
            type="button"
            onClick={toggleVoice}
            className={`grid h-9 w-9 place-items-center rounded-xl border transition ${
              voiceOn
                ? "border-lime/40 bg-lime/10 text-lime"
                : "border-line text-muted hover:text-white"
            }`}
            aria-label={voiceOn ? "Turn bot voice off" : "Read replies aloud"}
            title={voiceOn ? "Voice on — replies are spoken" : "Read replies aloud"}
          >
            {voiceOn ? <VolumeIcon width={15} height={15} /> : <VolumeOffIcon width={15} height={15} />}
          </button>
          <Link
            href={`/studio/${bot.id}`}
            className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-white"
            aria-label="Edit bot"
          >
            <EditIcon width={15} height={15} />
          </Link>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              bot={bot}
              userName={userName}
              onSpeak={speak}
            />
          ))}

          {sending ? (
            <div className="animate-fade flex gap-2.5">
              <Avatar bot={bot} size={34} glow={false} />
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-line/80 bg-panel/70 px-4 py-3">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-lime" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-lime" style={{ animationDelay: "150ms" }} />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-lime" style={{ animationDelay: "300ms" }} />
                <span className="ml-1 text-[11px] text-muted">{bot.name} is typing</span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200">
              {error}
            </div>
          ) : null}

          {showStarters && starters.length ? (
            <div className="mt-2">
              <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">
                Try opening with
              </p>
              <div className="flex flex-wrap gap-2">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    className="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-left text-xs text-white/75 transition hover:border-lime/40 hover:bg-lime/[0.06] hover:text-white"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-line/70 bg-ink/70 px-3 pt-3 pb-4 backdrop-blur-xl sm:px-5">
        <div className="mx-auto w-full max-w-3xl">
          {notice ? (
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-3 py-2 text-[11px] text-amber-100/90">
              <span className="flex-1">{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-amber-200/70 hover:text-amber-100"
                aria-label="Dismiss notice"
              >
                ✕
              </button>
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-panel/80 p-2 transition focus-within:border-lime/40 focus-within:ring-2 focus-within:ring-lime/10">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                resize();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={`Message ${bot.name}…`}
              className="max-h-[10.5rem] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white placeholder:text-muted/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={sending || input.trim().length === 0}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime text-ink transition hover:bg-lime-soft disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-muted"
              aria-label="Send message"
            >
              <SendIcon width={17} height={17} />
            </button>
          </div>
          <p className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted/70">
            <span>Enter to send · Shift + Enter for a new line</span>
            <span className="hidden sm:inline">Private · runs locally</span>
          </p>
        </div>
      </div>
    </div>
  );
}
