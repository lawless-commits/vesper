"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import {
  ArrowRightIcon,
  BoltIcon,
  CheckIcon,
  ChatIcon,
  CloseIcon,
  PlayIcon,
  ShieldIcon,
  SparkIcon,
  TrashIcon,
} from "@/components/Icons";
import {
  ACTION_KINDS,
  ACTION_META,
  type AutopilotSnapshot,
  type RunView,
} from "@/lib/autopilot-shared";
import { timeAgo } from "@/lib/utils";

const CADENCES = [
  { value: 15, label: "every 15 min" },
  { value: 60, label: "hourly" },
  { value: 180, label: "every 3 hours" },
  { value: 720, label: "twice a day" },
  { value: 1440, label: "daily" },
];

function kindMeta(kind: string) {
  return ACTION_META[(kind as keyof typeof ACTION_META) in ACTION_META ? (kind as keyof typeof ACTION_META) : "journal"];
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === "pending"
      ? "border-amber-300/40 bg-amber-300/10 text-amber-200"
      : status === "dismissed"
        ? "border-line bg-white/[0.03] text-muted"
        : "border-lime/35 bg-lime/10 text-lime";
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${styles}`}>
      {status}
    </span>
  );
}

export function AutopilotDashboard({ initial }: { initial: AutopilotSnapshot }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AutopilotSnapshot>(initial);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [lastTick, setLastTick] = useState<string | null>(null);
  const liveRef = useRef(false);
  const ticking = useRef(false);

  useEffect(() => {
    liveRef.current = live;
    try {
      window.localStorage.setItem("vesper:autopilot-live", live ? "on" : "off");
    } catch {
      // ignore
    }
  }, [live]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("vesper:autopilot-live") === "on") setLive(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(timer);
  }, [toast]);

  const tick = useCallback(
    async (silent = false) => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        const response = await fetch("/api/automation/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "tick" }),
        });
        const data = (await response.json()) as {
          snapshot?: AutopilotSnapshot;
          outcomes?: Array<{ botName: string; summary: string; status: string }>;
        };
        if (!response.ok || !data.snapshot) throw new Error("Tick failed");
        setSnapshot(data.snapshot);
        setLastTick(new Date().toLocaleTimeString());
        const executed = (data.outcomes ?? []).filter((outcome) => outcome.status !== "skipped");
        if (!silent) {
          setToast(
            executed.length
              ? executed.map((outcome) => `${outcome.botName}: ${outcome.summary}`).join(" · ")
              : "Nothing was due. Cadence and quiet hours are doing their job.",
          );
        }
      } catch {
        if (!silent) setError("Couldn't run an autonomy cycle just now.");
      } finally {
        ticking.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    if (!live) return;
    const interval = setInterval(() => {
      if (liveRef.current) void tick(true);
    }, 30_000);
    return () => clearInterval(interval);
  }, [live, tick]);

  async function updateAutomation(botId: number, patch: Record<string, unknown>) {
    setBusy(`automation-${botId}`);
    setError(null);
    try {
      const response = await fetch("/api/automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, ...patch }),
      });
      const data = (await response.json()) as { automations?: AutopilotSnapshot["automations"]; error?: string };
      if (!response.ok || !data.automations) throw new Error(data.error ?? "Could not save");
      setSnapshot((current) => ({ ...current, automations: data.automations! }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function runBot(botId: number) {
    setBusy(`run-${botId}`);
    setError(null);
    try {
      const response = await fetch("/api/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "bot", botId, force: true }),
      });
      const data = (await response.json()) as {
        outcomes?: Array<{ botName: string; summary: string }>;
        snapshot?: AutopilotSnapshot;
        error?: string;
      };
      if (!response.ok || !data.snapshot) throw new Error(data.error ?? "Run failed");
      setSnapshot(data.snapshot);
      setLastTick(new Date().toLocaleTimeString());
      setToast(data.outcomes?.[0] ? `${data.outcomes[0].botName}: ${data.outcomes[0].summary}` : "Cycle complete.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setBusy(null);
    }
  }

  async function decideRun(runId: number, decision: "approve" | "dismiss") {
    setBusy(`run-${runId}`);
    setError(null);
    try {
      const response = await fetch("/api/automation/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: runId, decision }),
      });
      const data = (await response.json()) as { snapshot?: AutopilotSnapshot; error?: string };
      if (!response.ok || !data.snapshot) throw new Error(data.error ?? "Could not update");
      setSnapshot(data.snapshot);
      setToast(decision === "approve" ? "Delivered into the chat thread." : "Draft dismissed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  async function toggleTask(id: number, done: boolean) {
    setBusy(`task-${id}`);
    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, done }),
      });
      const data = (await response.json()) as { snapshot?: AutopilotSnapshot };
      if (data.snapshot) setSnapshot(data.snapshot);
      router.refresh();
    } catch {
      setError("Couldn't update that task.");
    } finally {
      setBusy(null);
    }
  }

  async function createTask() {
    const botId = snapshot.automations[0]?.botId;
    if (!newTask.trim() || !botId) return;
    setBusy("new-task");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botId, title: newTask.trim() }),
      });
      const data = (await response.json()) as { snapshot?: AutopilotSnapshot };
      if (data.snapshot) setSnapshot(data.snapshot);
      setNewTask("");
      router.refresh();
    } catch {
      setError("Couldn't add that task.");
    } finally {
      setBusy(null);
    }
  }

  const stats = snapshot.stats;
  const anyEnabled = stats.enabled > 0;
  const enabledBots = useMemo(() => snapshot.automations.filter((item) => item.enabled), [snapshot.automations]);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-line/80 bg-panel/50 p-5">
        <div className="pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full bg-lime/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BoltIcon width={16} height={16} className="text-lime" />
              <h2 className="text-sm font-semibold text-white">Autopilot heartbeat</h2>
              <span
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${
                  live ? "border-lime/40 bg-lime/10 text-lime" : "border-line text-muted"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-lime" : "bg-muted"}`} />
                {live ? "live" : "paused"}
              </span>
            </div>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
              A scheduler checks for due bots and lets them act on their own. Keep this tab open for the
              heartbeat, or call the same endpoint from cron for true 24/7 autonomy.
            </p>
            <p className="mt-1.5 font-mono text-[10px] text-muted/70">
              {lastTick ? `last cycle ${lastTick}` : "no cycle run in this session"} · {stats.enabled}/{stats.total} bots armed
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLive((value) => !value)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                live ? "bg-white text-ink hover:bg-white/90" : "bg-lime text-ink hover:bg-lime-soft"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${live ? "bg-ink" : "bg-ink/70"}`} />
              {live ? "Pause heartbeat" : "Go live"}
            </button>
            <button
              type="button"
              onClick={() => void tick(false)}
              disabled={busy === "tick"}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm text-white transition hover:border-white/25 disabled:opacity-60"
            >
              <PlayIcon width={14} height={14} /> Run a cycle
            </button>
          </div>
        </div>

        {toast ? (
          <div className="relative mt-3 rounded-xl border border-lime/25 bg-lime/[0.07] px-3 py-2 text-[11px] text-lime">
            {toast}
          </div>
        ) : null}
        {error ? (
          <div className="relative mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
            {error}
          </div>
        ) : null}
        {!anyEnabled ? (
          <div className="relative mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[11px] text-muted">
            Nothing is armed yet — arm a bot below and it will start acting on its own cadence.
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Bots armed", value: `${stats.enabled}/${stats.total}`, icon: BoltIcon },
          { label: "Actions today", value: String(stats.actionsToday), icon: SparkIcon },
          { label: "Awaiting approval", value: String(stats.pending), icon: ShieldIcon },
          { label: "Open tasks", value: String(stats.openTasks), icon: CheckIcon },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl border border-line/70 bg-panel/40 px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
                <Icon width={11} height={11} /> {stat.label}
              </div>
              <p className="mt-1 text-lg font-semibold text-white">{stat.value}</p>
            </div>
          );
        })}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Per-bot autonomy</h2>
            <p className="text-xs text-muted">Cadence, allowed actions and the safety rails for each companion.</p>
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {snapshot.automations.map((item) => {
            const botBusy = busy === `automation-${item.botId}`;
            return (
              <div
                key={item.botId}
                className={`rounded-2xl border p-4 transition ${
                  item.enabled ? "border-lime/25 bg-lime/[0.03]" : "border-line/70 bg-panel/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Avatar bot={item.bot} size={42} online={item.enabled} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{item.bot.name}</p>
                      {item.enabled ? (
                        <span className="rounded-full bg-lime/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase">
                          armed
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-muted">
                      {item.lastRunAt ? `last acted ${timeAgo(item.lastRunAt)}` : "never acted on its own"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={botBusy}
                    onClick={() => void updateAutomation(item.botId, { enabled: !item.enabled })}
                    aria-label={item.enabled ? "Disarm autopilot" : "Arm autopilot"}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      item.enabled ? "bg-lime" : "bg-white/15"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all ${
                        item.enabled ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ACTION_KINDS.map((kind) => {
                    const active = item.actions.includes(kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        disabled={botBusy}
                        title={ACTION_META[kind].hint}
                        onClick={() =>
                          void updateAutomation(item.botId, {
                            actions: active
                              ? item.actions.filter((action) => action !== kind)
                              : [...item.actions, kind],
                          })
                        }
                        className={`rounded-lg border px-2 py-1 text-[10px] transition ${
                          active
                            ? "border-lime/40 bg-lime/10 text-lime"
                            : "border-line bg-white/[0.02] text-muted hover:text-white"
                        }`}
                      >
                        <span className="mr-1 font-mono">{ACTION_META[kind].glyph}</span>
                        {ACTION_META[kind].label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[9px] font-semibold tracking-[0.12em] text-muted uppercase">
                      cadence
                    </span>
                    <select
                      value={item.cadenceMinutes}
                      disabled={botBusy}
                      onChange={(event) =>
                        void updateAutomation(item.botId, { cadenceMinutes: Number(event.target.value) })
                      }
                      className="w-full rounded-lg border border-line bg-ink/70 px-2 py-1.5 text-[11px] text-white focus:border-lime/50 focus:outline-none"
                    >
                      {CADENCES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[9px] font-semibold tracking-[0.12em] text-muted uppercase">
                      daily cap
                    </span>
                    <select
                      value={item.dailyLimit}
                      disabled={botBusy}
                      onChange={(event) =>
                        void updateAutomation(item.botId, { dailyLimit: Number(event.target.value) })
                      }
                      className="w-full rounded-lg border border-line bg-ink/70 px-2 py-1.5 text-[11px] text-white focus:border-lime/50 focus:outline-none"
                    >
                      {[2, 4, 6, 10, 20].map((limit) => (
                        <option key={limit} value={limit}>
                          {limit} / day
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-2.5 space-y-1.5">
                  <button
                    type="button"
                    disabled={botBusy}
                    onClick={() => void updateAutomation(item.botId, { requireApproval: !item.requireApproval })}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-muted transition hover:text-white"
                  >
                    <span>DMs need my approval</span>
                    <span className={item.requireApproval ? "text-lime" : "text-muted/60"}>
                      {item.requireApproval ? "on" : "auto-send"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={botBusy}
                    onClick={() => void updateAutomation(item.botId, { useModel: !item.useModel })}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-muted transition hover:text-white"
                  >
                    <span>Draft DMs with my local model</span>
                    <span className={item.useModel ? "text-lime" : "text-muted/60"}>
                      {item.useModel ? "model" : "built-in"}
                    </span>
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <Link
                    href={`/bots/${item.bot.handle}`}
                    className="flex items-center gap-1 text-[10px] text-muted transition hover:text-white"
                  >
                    profile <ArrowRightIcon width={10} height={10} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void runBot(item.botId)}
                    disabled={busy === `run-${item.botId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-white transition hover:border-lime/40 hover:text-lime disabled:opacity-60"
                  >
                    <PlayIcon width={10} height={10} />
                    {busy === `run-${item.botId}` ? "acting…" : "act now"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-line/70 bg-panel/40 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Activity feed</h2>
            <span className="font-mono text-[10px] text-muted">{snapshot.runs.length} actions</span>
          </div>
          <div className="mt-3 space-y-2">
            {snapshot.runs.length ? (
              snapshot.runs.map((run: RunView) => (
                <div key={run.id} className="rounded-xl border border-line/60 bg-ink/50 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted">{kindMeta(run.kind).glyph}</span>
                    <span className="text-[11px] font-medium text-white/90">{run.botName}</span>
                    <span className="text-[9px] tracking-wider text-muted uppercase">{kindMeta(run.kind).label}</span>
                    <StatusPill status={run.status} />
                    <span className="ml-auto text-[10px] text-muted/70">{timeAgo(run.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/75">{run.content}</p>
                  {run.partnerContent && run.partnerName ? (
                    <div className="mt-2 rounded-lg border border-line/60 bg-white/[0.02] p-2">
                      <p className="text-[10px] font-medium text-muted">{run.partnerName} replied</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-white/65">{run.partnerContent}</p>
                    </div>
                  ) : null}
                  {run.status === "pending" ? (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy === `run-${run.id}`}
                        onClick={() => void decideRun(run.id, "approve")}
                        className="inline-flex items-center gap-1 rounded-lg bg-lime px-2.5 py-1 text-[10px] font-semibold text-ink transition hover:bg-lime-soft disabled:opacity-60"
                      >
                        <CheckIcon width={10} height={10} /> send it
                      </button>
                      <button
                        type="button"
                        disabled={busy === `run-${run.id}`}
                        onClick={() => void decideRun(run.id, "dismiss")}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[10px] text-muted transition hover:text-white disabled:opacity-60"
                      >
                        <CloseIcon width={10} height={10} /> dismiss
                      </button>
                    </div>
                  ) : null}
                  {run.status === "sent" && run.conversationId ? (
                    <Link
                      href={`/chats/${run.conversationId}`}
                      className="mt-2 inline-flex items-center gap-1 text-[10px] text-lime transition hover:text-lime-soft"
                    >
                      <ChatIcon width={10} height={10} /> open the thread
                    </Link>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-line p-6 text-center">
                <p className="text-xs text-white">No autonomous actions yet.</p>
                <p className="mt-1 text-[11px] text-muted">
                  Arm a bot, then hit “Run a cycle” to see it act immediately.
                </p>
              </div>
            )}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-line/70 bg-panel/40 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Shared task list</h2>
              <span className="font-mono text-[10px] text-muted">{stats.openTasks} open</span>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={newTask}
                onChange={(event) => setNewTask(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createTask();
                }}
                placeholder="Add your own follow-up"
                className="w-full rounded-lg border border-line bg-ink/60 px-2.5 py-1.5 text-[11px] text-white placeholder:text-muted/50 focus:border-lime/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void createTask()}
                disabled={busy === "new-task" || !newTask.trim()}
                className="shrink-0 rounded-lg border border-line px-2.5 text-[11px] text-white transition hover:border-lime/40 disabled:opacity-50"
              >
                add
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {snapshot.tasks.length ? (
                snapshot.tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-start gap-2 rounded-lg border border-line/60 bg-ink/40 px-2.5 py-2 ${
                      task.done ? "opacity-50" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void toggleTask(task.id, !task.done)}
                      disabled={busy === `task-${task.id}`}
                      aria-label={task.done ? "Reopen task" : "Mark task done"}
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
                        task.done ? "border-lime bg-lime text-ink" : "border-line text-transparent hover:border-lime/50"
                      }`}
                    >
                      <CheckIcon width={10} height={10} />
                    </button>
                    <div className="min-w-0">
                      <p className={`text-[11.5px] leading-snug ${task.done ? "text-muted line-through" : "text-white/85"}`}>
                        {task.title}
                      </p>
                      {task.detail ? <p className="mt-0.5 text-[10px] leading-snug text-muted">{task.detail}</p> : null}
                      <p className="mt-0.5 text-[9px] text-muted/60">
                        by {task.botName} · {timeAgo(task.createdAt)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-muted">
                  Bots will add follow-ups here when their task action fires.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-line/70 bg-panel/40 p-4">
            <h2 className="text-sm font-semibold text-white">Run it 24/7 with cron</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              The heartbeat above only lives while a tab is open. For real unattended autonomy, point any
              scheduler at the same endpoint.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-line/70 bg-ink/80 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-white/65">
{`# every 15 minutes
*/15 * * * * curl -s -X POST \\
  http://localhost:3000/api/automation/run \\
  -H 'content-type: application/json' \\
  -H 'x-autopilot-token: YOUR_TOKEN' \\
  -d '{"mode":"tick"}'`}
            </pre>
            <p className="mt-2 text-[10px] leading-relaxed text-muted/70">
              Set <span className="font-mono text-white/70">AUTOPILOT_TOKEN</span> in{" "}
              <span className="font-mono">.env.local</span> to require that header from anything that isn&apos;t this
              app&apos;s own pages. Without it, drop the header line.
            </p>
          </section>

          {enabledBots.length ? (
            <section className="rounded-2xl border border-lime/20 bg-lime/[0.04] p-4">
              <div className="flex items-center gap-2">
                <ShieldIcon width={13} height={13} className="text-lime" />
                <h2 className="text-sm font-semibold text-white">Rails that always apply</h2>
              </div>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted">
                <li>
                  · Quiet hours 01:00–07:00 ({snapshot.timezone}) — no autonomous messages. Change the timezone
                  in Runtime.
                </li>
                <li>· Per-bot daily cap and a minimum cadence of 5 minutes.</li>
                <li>· DMs can require approval before they reach your chat.</li>
                <li>· Everything is logged in the activity feed, nothing is deleted silently.</li>
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[10px] text-muted/70">
        <TrashIcon width={11} height={11} />
        Autonomy is simulated locally: bots act on their own schedule, but they only touch your local Postgres.
      </p>
    </div>
  );
}
