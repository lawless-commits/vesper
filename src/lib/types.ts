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

export type RuntimeView = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  userName: string;
};
