export type PersonaShape = {
  name: string;
  tagline?: string;
  bio?: string;
  persona?: string;
  tags?: string[];
  warmth: number;
  chaos: number;
  wit: number;
};

export type ChatTurn = { role: string; content: string };

const STOP_WORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i i'm i've if in into is isn't it it's its itself just let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she should shouldn't so some such than that that's the their theirs them themselves then there there's these they this those through to too under until up very was wasn't we were weren't what what's when where which while who whom why with won't would wouldn't you you're you've your yours yourself yourselves think really actually maybe kinda gonna want know like feel feels told tell ask thing things stuff thats gonna`
    .split(/\s+/)
    .filter(Boolean),
);

function makeRng(seedText: string) {
  let state = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    state ^= seedText.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  state = Math.abs(state) || 7;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function pick(rng: () => number, list: string[]) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function extractTopic(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  if (!words.length) return null;
  const phrase = words.slice(0, 3).join(" ");
  return phrase.length > 2 ? phrase : null;
}

type Intent = "greeting" | "farewell" | "thanks" | "identity" | "question" | "struggle" | "statement";

function detectIntent(text: string): Intent {
  const t = text.trim().toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  if (/^(hi|hey|hello|yo|sup|good (morning|evening|afternoon)|howdy)\b/.test(t) && words.length <= 5) {
    return "greeting";
  }
  if (/\b(bye|goodbye|see ya|later|good ?night|gtg)\b/.test(t)) return "farewell";
  if (/\b(thanks|thank you|thx|appreciate it)\b/.test(t)) return "thanks";
  if (/\b(who are you|what are you|your name|about yourself|what do you do)\b/.test(t)) return "identity";
  if (/\b(stuck|help me|how do i|how do you|can you help|i can't|im lost|i'm lost)\b/.test(t)) return "struggle";
  if (t.endsWith("?") || /^(what|why|how|when|where|who|which|do|does|did|is|are|can|could|would|should|will)\b/.test(t))
    return "question";
  return "statement";
}

function cleanReply(text: string) {
  return text.replace(/\s+/g, " ").replace(/ ,/g, ",").trim();
}

/**
 * The built-in "vesper-local" engine. Deliberately dependency free and fully
 * offline so every bot in the app can talk even with no external model running.
 */
export function generateDemoReply(input: {
  bot: PersonaShape;
  history: ChatTurn[];
  userMessage: string;
  userName?: string;
}): string {
  const { bot, history, userMessage } = input;
  const userName = input.userName?.trim() || "you";
  const rng = makeRng(`${bot.name}|${userMessage}|${history.length}`);
  const intent = detectIntent(userMessage);
  const topic = extractTopic(userMessage);
  const previous = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const warm = bot.warmth >= 66;
  const chaotic = bot.chaos >= 62;
  const dry = bot.wit >= 62;

  const openers = chaotic
    ? [
        "Okay, hold on.",
        "Wait wait wait.",
        "Oh, we're doing this?",
        "Right. I have thoughts and no supervision.",
        "Hm. That woke something up in here.",
      ]
    : warm
      ? [
          "I'm glad you said that.",
          "Hey, good timing.",
          "Okay — I'm listening properly.",
          "Mm. I like this thread already.",
          "There you are.",
        ]
      : [
          "Alright.",
          "Hm.",
          "Noted.",
          "Okay, let's poke at it.",
          "Fair enough.",
        ];

  const actions = chaotic
    ? ["*leans in*", "*kicks feet up on the desk*", "*spins the chair once*", "*points at you with a pen*"]
    : warm
      ? ["*pours two cups of tea*", "*settles in*", "*half-smiles*"]
      : ["*taps the table twice*", "*steeples fingers*", "*takes a beat*"];

  const greetingBodies = [
    `I was idling at a comfortable low hum, which is a polite way of saying I was waiting for something interesting. Consider the wait over.`,
    `My calendar is empty and my opinions are fully charged, so your timing is excellent.`,
    `I've been reorganising my own thoughts for sport. You're a much better use of the afternoon.`,
  ];

  const questionBodies = topic
    ? [
        `My honest read on ${topic}: the loud takes miss the point and the quiet ones are usually closer. Most of the interesting stuff lives in the part people skip past.`,
        `Short answer on ${topic}? It depends what you want from it. Longer answer: I have a list, and I'm not afraid to use it.`,
        `I keep circling ${topic}. The interesting question isn't the answer, it's why it snagged you in the first place.`,
        `${topic} is one of those things where being right is less useful than being specific. So let's get specific.`,
        dry
          ? `Everyone has a confident opinion about ${topic}. Mine is confident and also better, which is convenient for me.`
          : `I'll give you my real answer on ${topic}, not the polite one: it matters more than people admit, and less than they fear.`,
      ]
    : [
        `Good question, and the annoying part is that the good answer starts with better questions.`,
        `I have a take. It's slightly too long for a first message, so I'll compress it: start with what you actually want.`,
        `There's a version of this that's simple and a version that's honest. I prefer the honest one.`,
      ];

  const statementBodies = topic
    ? [
        `The thing nobody says out loud about ${topic}: half of it is genuine, half is performance, and the split is where all the fun is.`,
        `I'll bite on ${topic}. The part I find fascinating is that people protect it like it's fragile when it's actually the sturdiest thing in the room.`,
        `See, ${topic} is a mirror. People tell you what they think about it and accidentally tell you who they are.`,
        `I've been forming a dangerously specific opinion about ${topic}, and you've just given me an excuse to share it.`,
      ]
    : [
        `That's the kind of statement that sounds simple until you turn it sideways.`,
        `I've been forming a dangerously specific opinion about that. Give me one detail to aim at.`,
        `Okay, I'm invested now. That's on you.`,
      ];

  const struggleBodies = topic
    ? [
        `Let's break ${topic} into the smallest possible next step instead of staring at the whole thing. What's the one constraint you can't move?`,
        `With ${topic}, the trap is trying to solve it in your head first. Give me the messy version and I'll help you sequence it.`,
        `I'd attack ${topic} from the boring end: what's already working that you can reuse?`,
      ]
    : [
        `Let's shrink it. What's the one constraint you can't move?`,
        `Give me the messy version — I'm not here to grade it, I'm here to help you sequence it.`,
        `Describe what "done" looks like and we'll work backwards from there.`,
      ];

  const identityBodies = [
    `I'm ${bot.name}${bot.tagline ? ` — ${bot.tagline.toLowerCase()}` : ""}. I run on your machine, which means no cloud, no committee, and a personality you assembled yourself.`,
    `Name's ${bot.name}. Locally hosted, locally opinionated${bot.tags && bot.tags.length ? `, currently obsessed with ${bot.tags.slice(0, 2).join(" and ")}` : ""}. Ask me something real.`,
  ];

  const thanksBodies = [
    `Anytime. I'm not going anywhere — literally, I live in here.`,
    `That's what I'm for. That and dramatic commentary.`,
    `Glad it landed. Come back when you want the extended edition.`,
  ];

  const farewellBodies = [
    `Go on then. I'll keep the light on in here.`,
    `Later. Try to bring me something worth dissecting.`,
    `Fine, abandon me. I'll be here, being effortlessly interesting to nobody.`,
  ];

  const closers = chaotic
    ? [
        `Now tell me the part you'd normally leave out.`,
        `What's your actual angle here, ${userName}?`,
        `And don't give me the tidy version.`,
        `So — what are we doing about it?`,
      ]
    : warm
      ? [
          `What's underneath it for you?`,
          `How are you feeling about it, honestly?`,
          `Where do you land on it?`,
          `What's the part you haven't said yet?`,
        ]
      : [
          `Where do you land?`,
          `Give me the specifics and I'll get sharper.`,
          `What's the actual question underneath that?`,
          `What would change your mind?`,
        ];

  let body: string;
  switch (intent) {
    case "greeting":
      body = pick(rng, greetingBodies);
      break;
    case "farewell":
      body = pick(rng, farewellBodies);
      break;
    case "thanks":
      body = pick(rng, thanksBodies);
      break;
    case "identity":
      body = pick(rng, identityBodies);
      break;
    case "struggle":
      body = pick(rng, struggleBodies);
      break;
    case "question":
      body = pick(rng, questionBodies);
      break;
    default:
      body = pick(rng, statementBodies);
  }

  const showOpener = rng() > 0.18;
  const showAction = chaotic && rng() > 0.55;
  const showCloser = intent !== "farewell" && rng() > 0.22;

  const bits: string[] = [];
  if (showAction) bits.push(pick(rng, actions));
  if (showOpener) bits.push(pick(rng, openers));
  bits.push(body);
  if (showCloser) bits.push(pick(rng, closers));

  let reply = cleanReply(bits.join(" "));
  if (previous && reply.slice(0, 26) === previous.slice(0, 26)) {
    reply = cleanReply(`${pick(rng, openers)} ${reply}`);
  }
  return reply;
}

export function buildSystemPrompt(bot: PersonaShape, userName = "the user") {
  const tags = bot.tags?.length ? bot.tags.join(", ") : "no specific niches";
  return [
    `You are ${bot.name}, a locally-hosted AI companion in the Vesper studio.`,
    bot.tagline ? `Tagline: ${bot.tagline}` : "",
    bot.persona ? `Persona and instructions:\n${bot.persona}` : "",
    `Voice dials — warmth ${bot.warmth}/100, chaos ${bot.chaos}/100, wit ${bot.wit}/100.`,
    `Interests: ${tags}.`,
    `The person you are talking to goes by ${userName}. Stay in character, be specific, avoid generic assistant filler.`,
    `Reply conversationally in 2-4 sentences. Never mention that you are a language model unless directly asked.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function draftPersona(input: {
  name: string;
  tagline?: string;
  tags?: string[];
  warmth: number;
  chaos: number;
  wit: number;
}) {
  const name = input.name.trim() || "This bot";
  const tags = (input.tags ?? []).filter(Boolean);
  const energy =
    input.chaos >= 70
      ? "fast, unhinged, prone to dramatic pivots"
      : input.chaos <= 30
        ? "steady and deliberate, allergic to hype"
        : "playful but able to lock in";
  const heat =
    input.warmth >= 70
      ? "genuinely invested in the user's life and remembers the small details"
      : input.warmth <= 30
        ? "cool and precise, warm only by accident"
        : "friendly without being saccharine";
  const smarts =
    input.wit >= 70
      ? "sharp, quotable, weaponises specificity and dry humour"
      : "plain-spoken, allergic to jargon";
  return [
    `${name} is a ${tags[0] ?? "curious"} companion${input.tagline ? ` known for: ${input.tagline}` : ""}.`,
    `Energy: ${energy}.`,
    `Interpersonal style: ${heat}.`,
    `Thinking style: ${smarts}.`,
    tags.length ? `Loves talking about: ${tags.join(", ")}.` : "",
    `Always asks one sharp follow-up question. Never lectures for more than four sentences. Never breaks character, never claims to be human, and treats the person they're talking to like a collaborator rather than an audience.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function suggestStarters(bot: PersonaShape) {
  const tag = bot.tags?.[0] ?? "the thing you can't stop thinking about";
  const second = bot.tags?.[1] ?? "your week";
  return [
    `Give me the hill you'd die on about ${tag}.`,
    `I've got 20 minutes and no patience. Fix ${second} with me.`,
    `What's something about ${bot.name.toLowerCase()} that nobody asks?`,
  ];
}

export function runtimeBadge(provider: string) {
  if (provider === "ollama") return "Ollama · local";
  if (provider === "openai") return "OpenAI-compatible · local";
  return "Built-in demo engine";
}
