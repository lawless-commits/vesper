/**
 * Single source of truth for what the bots in Vesper can and cannot do.
 * Pure data (no DB imports) so both server and client code can render it.
 */

export type Capability = {
  id: string;
  title: string;
  glyph: string;
  status: "live" | "partial" | "absent";
  summary: string;
  detail: string;
  where: { label: string; href: string };
};

export const CAPABILITIES: Capability[] = [
  {
    id: "persona",
    title: "Character personality",
    glyph: "✳",
    status: "live",
    summary: "Every reply is shaped by a full persona, not a generic assistant voice.",
    detail:
      "Each bot has a system prompt plus warmth / chaos / wit dials, a temperature, vibe tags, a greeting and icebreakers. All of it is packed into the prompt on every turn, so two bots with the same local model behave like different characters.",
    where: { label: "Bot studio", href: "/studio" },
  },
  {
    id: "local-model",
    title: "Runs on your own model",
    glyph: "⚙",
    status: "live",
    summary: "Ollama, LM Studio, llama.cpp or vLLM — or no model at all.",
    detail:
      "Vesper talks to Ollama's native /api/chat and to any OpenAI-compatible /v1/chat/completions server. You can list available models from the runtime panel. Requests go straight from your machine to localhost, with no third-party hop.",
    where: { label: "Runtime", href: "/runtime" },
  },
  {
    id: "builtin",
    title: "Built-in offline engine",
    glyph: "⚡",
    status: "live",
    summary: "Bots still answer when your model is down or not installed.",
    detail:
      "A dependency-free engine reads intent, extracts a topic and composes in-character replies using the bot's dials. If a configured local model fails or times out, the reply silently falls back to it so a conversation never breaks.",
    where: { label: "Try any chat", href: "/chats" },
  },
  {
    id: "memory",
    title: "Conversation memory",
    glyph: "◈",
    status: "partial",
    summary: "Remembers the current thread; does not remember across threads.",
    detail:
      "Each request carries the last 12 turns of that conversation plus the persona. There is no vector memory or long-term profile yet, so a brand-new thread starts from the persona alone. History is capped at 4,000 characters per message.",
    where: { label: "Your chats", href: "/chats" },
  },
  {
    id: "transcripts",
    title: "Permanent transcripts",
    glyph: "▤",
    status: "live",
    summary: "Every message is stored in your local Postgres.",
    detail:
      "Bots, chats and messages live in four durable tables. Threads are auto-titled from your first message, can be renamed or deleted, and each reply records which engine produced it (built-in or a specific model).",
    where: { label: "Your chats", href: "/chats" },
  },
  {
    id: "voice",
    title: "Spoken replies",
    glyph: "◍",
    status: "partial",
    summary: "Bots can read replies aloud using your browser's local voices.",
    detail:
      "The speaker toggle in a chat reads new replies with rate and pitch derived from the bot's chaos and warmth. It is output only — there is no speech-to-text, so you still type.",
    where: { label: "Open a chat", href: "/chats" },
  },
  {
    id: "identity",
    title: "Visual identity",
    glyph: "✦",
    status: "live",
    summary: "Monochrome Grok-style emblems, generated or custom.",
    detail:
      "Eight geometric emblem marks plus seeded variants, a per-bot accent colour, and support for any image URL. Avatars are deterministic SVG, so they cost nothing to store and never 404.",
    where: { label: "Studio avatar picker", href: "/studio" },
  },
  {
    id: "autonomy",
    title: "Scheduled autonomy",
    glyph: "↻",
    status: "live",
    summary: "Bots wake on a cadence and act without being prompted.",
    detail:
      "Journal posts, unprompted DMs, bot-to-bot relays and self-created tasks. Driven by an in-app heartbeat, a forced 'act now', or a cron job hitting /api/automation/run. Honest caveat: autonomy is an in-app scheduler, not a background daemon — nothing fires while the server is stopped.",
    where: { label: "Autopilot", href: "/autopilot" },
  },
  {
    id: "guardrails",
    title: "Guardrails & approvals",
    glyph: "⛨",
    status: "live",
    summary: "Quiet hours, daily caps, and a human in the loop for messages.",
    detail:
      "No autonomous action between 01:00–07:00, a per-bot daily cap, a five-minute minimum cadence, and DMs that wait for your approval by default. Every autonomous action is written to an audit feed with its status.",
    where: { label: "Autopilot rails", href: "/autopilot" },
  },
  {
    id: "collab",
    title: "Bot-to-bot conversation",
    glyph: "⇄",
    status: "partial",
    summary: "Two bots exchange an in-character opener and reply.",
    detail:
      "A relay generates both sides of a short exchange about a shared topic and logs it. It is a scripted two-turn exchange rather than a long-running multi-agent loop with a shared objective.",
    where: { label: "Activity feed", href: "/autopilot" },
  },
  {
    id: "web",
    title: "Web access & live data",
    glyph: "⊘",
    status: "absent",
    summary: "Bots cannot browse, search, fetch URLs or read live data.",
    detail:
      "There is no network tool, so anything after the model's training cutoff is unknown to it. Adding this means a fetch tool with an allowlist and injected search results — deliberately not wired up by default.",
    where: { label: "How to extend", href: "#extend" },
  },
  {
    id: "tools",
    title: "Real-world actions",
    glyph: "⊘",
    status: "absent",
    summary: "No shell, files, code execution, email, calendar or purchases.",
    detail:
      "Nothing leaves the app. Bots write only to their own local tables. Genuine automation (send a message, move a calendar event, run a script) needs a tool-calling loop with explicit per-tool permissions.",
    where: { label: "How to extend", href: "#extend" },
  },
  {
    id: "streaming",
    title: "Token streaming",
    glyph: "⊘",
    status: "absent",
    summary: "Replies arrive complete, not token by token.",
    detail:
      "The chat API is a single non-streaming POST with a typing indicator. Streaming is a contained change: forward the provider's SSE stream through a ReadableStream and render deltas.",
    where: { label: "How to extend", href: "#extend" },
  },
  {
    id: "accounts",
    title: "Multi-user accounts",
    glyph: "⊘",
    status: "absent",
    summary: "Single-user by design: no login, no sharing, no roles.",
    detail:
      "Everything is scoped to one local instance so there is no auth surface to leak. Exposing it on a network would need authentication before anything else.",
    where: { label: "Runtime notes", href: "/runtime" },
  },
  {
    id: "vision",
    title: "Images & vision",
    glyph: "⊘",
    status: "absent",
    summary: "Bots cannot see images or generate them.",
    detail:
      "Avatars are geometric emblems rather than generated portraits. Vision would require a multimodal model and base64 image parts in the chat payload.",
    where: { label: "How to extend", href: "#extend" },
  },
];

export const LIMITS = [
  {
    title: "They are not agents with a computer",
    body: "No browsing, no shell, no file system, no API credentials. Autopilot writes to the app's own database and nothing else.",
  },
  {
    title: "Autonomy needs the app running",
    body: "The heartbeat is a browser tab; the cron example is a real scheduler calling your server. Stop the server and no bot wakes up.",
  },
  {
    title: "Memory is short-term",
    body: "Twelve turns per conversation. Ask a different thread about your project and it truly does not know.",
  },
  {
    title: "Quality is your model's quality",
    body: "Without a local model the built-in engine is charming but shallow — it composes personality, it does not reason.",
  },
  {
    title: "No safety classifier",
    body: "Persona prompts are yours. There is no moderation layer; guardrail rails cover scheduling and approvals, not content.",
  },
];

export const EXTENSIONS = [
  {
    id: "webhooks",
    title: "Outbound automation (real actions)",
    body: "Let autopilot runs POST to a webhook you control. The bot decides when, your service decides what is allowed.",
    code: `// src/app/api/automation/runs/route.ts (after approveRun)
if (process.env.AUTOPILOT_WEBHOOK && decision === "approve") {
  await fetch(process.env.AUTOPILOT_WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bot: run.botId, text: run.content }),
  });
}`,
  },
  {
    id: "retrieval",
    title: "Web + document knowledge",
    body: "Store embeddings in Postgres (pgvector), fetch top matches for the user message, inject them as context before the persona prompt.",
    code: `const context = await searchChunks(userMessage, 5);
const system = [buildSystemPrompt(bot, userName),
  "Ground truth:\\n" + context.join("\\n")].join("\\n\\n");`,
  },
  {
    id: "longmemory",
    title: "Long-term memory",
    body: "After every N turns, summarise the thread into a bot_memories row and prepend recent summaries to the system prompt.",
    code: `await db.insert(botMemories).values({
  botId, summary: await summarise(thread),
  importance: 0.7, createdAt: new Date(),
});`,
  },
  {
    id: "streaming",
    title: "Token streaming",
    body: "Return the provider stream instead of JSON and render deltas in ChatView for that live-typing feel.",
    code: `return new Response(upstream.body, {
  headers: { "content-type": "text/event-stream" },
});`,
  },
  {
    id: "voicein",
    title: "Speech input",
    body: "Run a local Whisper server and pipe recorded audio to it; the transcript is just another user message.",
    code: `const text = await transcribe(audioBlob); // whisper.cpp :8080
await fetch("/api/chat", { method: "POST", body: JSON.stringify({
  conversationId, content: text,
}) });`,
  },
  {
    id: "tools",
    title: "Tool calling",
    body: "Give the model a small JSON tool schema, execute only allowlisted tools, and require approval for anything with side effects.",
    code: `const tools = [{ name: "add_task", description: "Add a task",
  parameters: { title: "string" } }];
// loop: model proposes -> validate -> execute -> feed result back`,
  },
];

export const API_SURFACE = [
  { method: "GET", path: "/api/bots", what: "Roster with chat counts" },
  { method: "POST", path: "/api/bots", what: "Create a bot (auto-persona if prompt empty)" },
  { method: "PATCH", path: "/api/bots", what: "Update a bot's persona, dials, avatar" },
  { method: "DELETE", path: "/api/bots/[id]", what: "Delete a bot and its chats" },
  { method: "POST", path: "/api/conversations", what: "Open a thread (greeting seeded)" },
  { method: "GET", path: "/api/conversations/[id]", what: "Full transcript, exportable JSON" },
  { method: "POST", path: "/api/chat", what: "One user turn → one in-character reply" },
  { method: "GET/PUT", path: "/api/runtime", what: "Read or change local model settings" },
  { method: "POST", path: "/api/runtime/test", what: "Probe the server, list its models" },
  { method: "GET/PUT", path: "/api/automation", what: "Autopilot state and per-bot config" },
  { method: "POST", path: "/api/automation/run", what: "Tick the scheduler, or force one bot. Outside the app, send x-autopilot-token when AUTOPILOT_TOKEN is set" },
  { method: "PATCH", path: "/api/automation/runs", what: "Approve or dismiss a drafted DM" },
  { method: "POST/PATCH", path: "/api/tasks", what: "Create or complete a task" },
  { method: "GET", path: "/api/health", what: "Database liveness probe" },
];
