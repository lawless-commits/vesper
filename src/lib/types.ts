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
};
