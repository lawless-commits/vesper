export type BotView = {
  id: number;
  name: string;
  handle: string;
  tagline: string;
  bio: string;
  persona: string;
  greeting: string;
  starters: string[];
  avatarUrl: string | null;
  avatarSeed: string;
  accent: string;
  tags: string[];
  warmth: number;
  chaos: number;
  wit: number;
  model: string;
  temperature: number;
  visibility: string;
  creator: string;
  featured: boolean;
  updatedAt: string;
  chatCount?: number;
};

export type MessageView = {
  id: number;
  role: "user" | "assistant" | string;
  content: string;
  engine: string;
  createdAt: string;
};

export type ConversationView = {
  id: number;
  botId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  bot: BotView;
  lastMessage: string | null;
  messageCount: number;
};

/**
 * Client-safe runtime settings. The API key itself never leaves the server;
 * the browser only learns whether one exists and where it comes from.
 */
export type RuntimeView = {
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  /** "env" = LLM_API_KEY environment variable, "stored" = saved in the database. */
  apiKeySource: "env" | "stored" | "none";
  temperature: number;
  userName: string;
  /** IANA timezone for autopilot quiet hours and the daily cap, e.g. "Africa/Johannesburg". */
  timezone: string;
  /** Seconds to wait for the model before falling back (10-300). */
  timeoutSeconds: number;
  /** Upper bound on reply length in tokens, applied to every provider (64-4000). */
  maxTokens: number;
};

export const RUNTIME_LIMITS = {
  timeoutSeconds: { min: 10, max: 300, fallback: 90 },
  maxTokens: { min: 64, max: 4000, fallback: 600 },
} as const;

/** Clamp a user-supplied runtime limit into its allowed range. */
export function clampRuntimeLimit(kind: keyof typeof RUNTIME_LIMITS, value: unknown): number {
  const { min, max, fallback } = RUNTIME_LIMITS[kind];
  const number = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
