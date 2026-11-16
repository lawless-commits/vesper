import type { BotView } from "@/lib/types";

export const ACTION_KINDS = ["journal", "dm", "relay", "task"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_META: Record<ActionKind, { label: string; hint: string; glyph: string }> = {
  journal: { label: "Journal", hint: "Publish a thought to its own transmission feed", glyph: "✳" },
  dm: { label: "Message you", hint: "Start a chat thread with you unprompted", glyph: "✉" },
  relay: { label: "Relay", hint: "Talk to another bot in your roster", glyph: "⇄" },
  task: { label: "Task", hint: "Add a follow-up to the shared task list", glyph: "✓" },
};

export type AutomationView = {
  botId: number;
  bot: BotView;
  enabled: boolean;
  cadenceMinutes: number;
  actions: string[];
  dailyLimit: number;
  requireApproval: boolean;
  useModel: boolean;
  lastRunAt: string | null;
};

export type RunView = {
  id: number;
  botId: number;
  botName: string;
  botHandle: string;
  kind: string;
  status: string;
  content: string;
  partnerBotId: number | null;
  partnerContent: string | null;
  partnerName: string | null;
  conversationId: number | null;
  createdAt: string;
};

export type TaskView = {
  id: number;
  botId: number;
  botName: string;
  title: string;
  detail: string;
  done: boolean;
  createdAt: string;
};

export type AutopilotStats = {
  enabled: number;
  total: number;
  actionsToday: number;
  pending: number;
  openTasks: number;
};

export type AutopilotSnapshot = {
  automations: AutomationView[];
  runs: RunView[];
  tasks: TaskView[];
  stats: AutopilotStats;
};
