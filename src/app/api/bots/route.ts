import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bots } from "@/db/schema";
import { ensureSeeded, toBotView } from "@/lib/data";
import { badRequest, parseId } from "@/lib/http";
import { draftPersona, suggestStarters } from "@/lib/persona";
import { handleify } from "@/lib/utils";

export const dynamic = "force-dynamic";

function stringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function avatar(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (
    raw.startsWith("/") ||
    raw.startsWith("https://") ||
    raw.startsWith("http://") ||
    raw.startsWith("data:image/") ||
    raw.startsWith("preset:")
  ) {
    return raw.slice(0, 2000);
  }
  return null;
}

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(bots).orderBy(desc(bots.featured), asc(bots.id));
  return Response.json({ bots: rows.map((row) => toBotView(row)) });
}

export async function POST(request: Request) {
  await ensureSeeded();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().slice(0, 48);
  if (!name) return Response.json({ error: "Every bot needs a name." }, { status: 400 });

  const tags = stringArray(body.tags, 6).map((tag) => tag.toLowerCase().slice(0, 24));
  const warmth = clampNumber(body.warmth, 60, 0, 100);
  const chaos = clampNumber(body.chaos, 35, 0, 100);
  const wit = clampNumber(body.wit, 65, 0, 100);
  const tagline = String(body.tagline ?? "").trim().slice(0, 120);
  const personaInput = { name, tagline, tags, warmth, chaos, wit };

  let handle = handleify(String(body.handle ?? "") || name);
  const existing = await db.select({ handle: bots.handle }).from(bots);
  const taken = new Set(existing.map((row) => row.handle));
  if (taken.has(handle)) {
    let counter = 2;
    while (taken.has(`${handle}-${counter}`)) counter += 1;
    handle = `${handle}-${counter}`;
  }

  const starters = stringArray(body.starters, 4);
  const greeting = String(body.greeting ?? "").trim().slice(0, 400);
  const persona = String(body.persona ?? "").trim().slice(0, 4000);

  const values = {
    name,
    handle,
    tagline,
    bio: String(body.bio ?? "").trim().slice(0, 1200),
    persona: persona || draftPersona(personaInput),
    greeting: greeting || `Hi, I'm ${name}. ${tagline || "Tell me what's on your mind."}`,
    starters: starters.length ? starters : suggestStarters(personaInput),
    avatarUrl: avatar(body.avatarUrl),
    avatarSeed: String(body.avatarSeed ?? "") || handle,
    accent: /^#[0-9a-fA-F]{6}$/.test(String(body.accent ?? "")) ? String(body.accent) : "#c9f954",
    tags,
    warmth,
    chaos,
    wit,
    model: String(body.model ?? "local").slice(0, 80) || "local",
    temperature: clampNumber(body.temperature, 0.8, 0, 1.5),
    visibility: body.visibility === "private" ? "private" : "public",
    creator: String(body.creator ?? "you").slice(0, 40),
    featured: false,
  };

  const created = await db.insert(bots).values(values).returning();
  return Response.json({ bot: toBotView(created[0]) }, { status: 201 });
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const id = parseId(body.id);
  if (id === null) return badRequest("Missing bot id");

  const rows = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
  const current = rows[0];
  if (!current) return Response.json({ error: "Bot not found" }, { status: 404 });

  const name = body.name === undefined ? current.name : String(body.name).trim().slice(0, 48) || current.name;
  const tags = body.tags === undefined ? current.tags : stringArray(body.tags, 6).map((t) => t.toLowerCase().slice(0, 24));
  const warmth = body.warmth === undefined ? current.warmth : clampNumber(body.warmth, current.warmth, 0, 100);
  const chaos = body.chaos === undefined ? current.chaos : clampNumber(body.chaos, current.chaos, 0, 100);
  const wit = body.wit === undefined ? current.wit : clampNumber(body.wit, current.wit, 0, 100);

  const updated = await db
    .update(bots)
    .set({
      name,
      tagline: body.tagline === undefined ? current.tagline : String(body.tagline).slice(0, 120),
      bio: body.bio === undefined ? current.bio : String(body.bio).slice(0, 1200),
      persona: body.persona === undefined ? current.persona : String(body.persona).slice(0, 4000),
      greeting: body.greeting === undefined ? current.greeting : String(body.greeting).slice(0, 400),
      starters: body.starters === undefined ? current.starters : stringArray(body.starters, 4),
      avatarUrl: body.avatarUrl === undefined ? current.avatarUrl : avatar(body.avatarUrl),
      avatarSeed: body.avatarSeed === undefined ? current.avatarSeed : String(body.avatarSeed).slice(0, 60),
      accent: /^#[0-9a-fA-F]{6}$/.test(String(body.accent ?? "")) ? String(body.accent) : current.accent,
      tags,
      warmth,
      chaos,
      wit,
      model: body.model === undefined ? current.model : String(body.model).slice(0, 80),
      temperature: body.temperature === undefined ? current.temperature : clampNumber(body.temperature, current.temperature, 0, 1.5),
      visibility: body.visibility === "private" ? "private" : body.visibility === "public" ? "public" : current.visibility,
      updatedAt: new Date(),
    })
    .where(eq(bots.id, id))
    .returning();

  return Response.json({ bot: toBotView(updated[0]) });
}
