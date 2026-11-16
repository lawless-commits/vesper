"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, SparkIcon, TrashIcon } from "@/components/Icons";
import {
  ACCENTS,
  GLYPH_PRESETS,
  glyphAvatar,
  presetAvatarUrl,
  type GlyphPresetId,
} from "@/lib/avatar";
import { draftPersona, suggestStarters } from "@/lib/persona";
import type { BotView } from "@/lib/types";
import { handleify, VIBE_TAGS } from "@/lib/utils";

type Props = { mode: "create" | "edit"; bot?: BotView };

const FIELD =
  "w-full rounded-xl border border-line bg-ink/60 px-3 py-2.5 text-sm text-white placeholder:text-muted/50 focus:border-lime/50 focus:ring-2 focus:ring-lime/10 focus:outline-none";
const LABEL = "mb-1.5 block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase";

export function BotStudioForm({ mode, bot }: Props) {
  const router = useRouter();
  const [name, setName] = useState(bot?.name ?? "");
  const [tagline, setTagline] = useState(bot?.tagline ?? "");
  const [bio, setBio] = useState(bot?.bio ?? "");
  const [persona, setPersona] = useState(bot?.persona ?? "");
  const [greeting, setGreeting] = useState(bot?.greeting ?? "");
  const [starters, setStarters] = useState<string[]>(
    bot?.starters?.length ? [...bot.starters, "", "", ""].slice(0, 3) : ["", "", ""],
  );
  const [avatarUrl, setAvatarUrl] = useState(bot?.avatarUrl ?? "");
  const [avatarSeed, setAvatarSeed] = useState(bot?.avatarSeed ?? (handleify(bot?.name ?? "") || "vesper"));
  const [accent, setAccent] = useState(bot?.accent ?? "#c9f954");
  const [tags, setTags] = useState<string[]>(bot?.tags ?? []);
  const [warmth, setWarmth] = useState(bot?.warmth ?? 65);
  const [chaos, setChaos] = useState(bot?.chaos ?? 40);
  const [wit, setWit] = useState(bot?.wit ?? 70);
  const [temperature, setTemperature] = useState(bot?.temperature ?? 0.8);
  const [visibility, setVisibility] = useState(bot?.visibility ?? "public");
  const [customTag, setCustomTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const previewBot = useMemo(
    () => ({
      name: name || "Untitled bot",
      avatarUrl: avatarUrl.trim() || null,
      avatarSeed: avatarSeed || "vesper",
      accent,
    }),
    [name, avatarUrl, avatarSeed, accent],
  );

  const procedural = useMemo(
    () =>
      [0, 1, 2, 3].map((index) => ({
        id: index,
        url: glyphAvatar(`${avatarSeed || "vesper"}-${index}`),
      })),
    [avatarSeed],
  );

  function selectPreset(id: GlyphPresetId) {
    setAvatarUrl(presetAvatarUrl(id));
    setAvatarSeed((current) => current.replace(/^preset:/, "").replace(/-\d+$/, "") || id);
  }

  function toggleTag(tag: string) {
    setTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      if (current.length >= 6) return current;
      return [...current, tag];
    });
  }

  function addCustomTag() {
    const clean = customTag.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20);
    if (!clean) return;
    if (!tags.includes(clean) && tags.length < 6) setTags([...tags, clean]);
    setCustomTag("");
  }

  function autofillPersona() {
    setPersona(
      draftPersona({
        name: name || "This bot",
        tagline,
        tags,
        warmth,
        chaos,
        wit,
      }),
    );
    if (!greeting) {
      setGreeting(`I'm ${name || "here"}. ${tagline || "Tell me something real."}`);
    }
    if (starters.every((starter) => !starter.trim())) {
      setStarters(
        suggestStarters({ name: name || "this bot", tagline, tags, warmth, chaos, wit }).slice(0, 3),
      );
    }
  }

  async function save() {
    if (!name.trim()) {
      setError("Give your bot a name first.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);

    const payload = {
      name,
      tagline,
      bio,
      persona,
      greeting,
      starters: starters.map((starter) => starter.trim()).filter(Boolean),
      avatarUrl: avatarUrl.trim(),
      avatarSeed: avatarSeed || handleify(name),
      accent,
      tags,
      warmth,
      chaos,
      wit,
      temperature,
      visibility,
      model: bot?.model ?? "local",
    };

    try {
      const response = await fetch(
        "/api/bots",
        {
          method: mode === "edit" && bot ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "edit" && bot ? { id: bot.id, ...payload } : payload),
        },
      );
      const data = (await response.json()) as { bot?: BotView; error?: string };
      if (!response.ok || !data.bot) throw new Error(data.error ?? "Could not save the bot.");
      setSaved(true);
      router.push(`/bots/${data.bot.handle}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the bot.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!bot) return;
    if (!window.confirm(`Delete ${bot.name} and every chat with them? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/bots/${bot.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not delete that bot.");
      setDeleting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Identity</h2>
            <span className="font-mono text-[10px] text-muted">@{handleify(name || "new-bot")}</span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="bot-name">
                Name
              </label>
              <input
                id="bot-name"
                className={FIELD}
                value={name}
                maxLength={48}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!bot) setAvatarSeed(handleify(event.target.value));
                }}
                placeholder="e.g. Kori"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="bot-tagline">
                Tagline
              </label>
              <input
                id="bot-tagline"
                className={FIELD}
                value={tagline}
                maxLength={120}
                onChange={(event) => setTagline(event.target.value)}
                placeholder="One line that sums up the vibe"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className={LABEL} htmlFor="bot-bio">
              Bio
            </label>
            <textarea
              id="bot-bio"
              className={`${FIELD} min-h-24 resize-y`}
              value={bio}
              maxLength={1200}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Who are they? What do they care about? What's the backstory?"
            />
          </div>
        </section>

        <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
          <h2 className="text-sm font-semibold text-white">Avatar emblem</h2>
          <p className="mt-0.5 text-xs text-muted">
            Monochrome geometric marks on a near-black plate — pick one, or generate a variant from a seed.
          </p>

          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
            {GLYPH_PRESETS.map((preset) => {
              const active = avatarUrl === presetAvatarUrl(preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset.id)}
                  className={`group relative overflow-hidden rounded-xl border transition ${
                    active ? "border-white/70 ring-1 ring-white/25" : "border-line hover:border-white/35"
                  }`}
                  title={preset.label}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={glyphAvatar(`${preset.id}-${avatarSeed || "vesper"}`, preset.id)}
                    alt={preset.label}
                    className="aspect-square w-full object-cover"
                  />
                  {active ? (
                    <span className="absolute right-1 bottom-1 grid h-4 w-4 place-items-center rounded-full bg-white text-ink">
                      <CheckIcon width={10} height={10} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
            Generated variants from seed
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {procedural.map((variant) => {
              const active = !avatarUrl && avatarSeed.endsWith(`-${variant.id}`);
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => {
                    setAvatarUrl("");
                    const baseSeed = avatarSeed.replace(/-\d+$/, "") || "vesper";
                    setAvatarSeed(`${baseSeed}-${variant.id}`);
                  }}
                  className={`overflow-hidden rounded-xl border transition ${
                    active ? "border-white/70 ring-1 ring-white/25" : "border-line hover:border-white/35"
                  }`}
                  title={`Generated look ${variant.id + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={variant.url}
                    alt={`Generated avatar ${variant.id + 1}`}
                    className="aspect-square w-full object-cover"
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="avatar-seed">
                Emblem seed
              </label>
              <div className="flex gap-2">
                <input
                  id="avatar-seed"
                  className={FIELD}
                  value={avatarSeed}
                  onChange={(event) => {
                    setAvatarUrl("");
                    setAvatarSeed(event.target.value);
                  }}
                  placeholder="anything you like"
                />
                <button
                  type="button"
                  onClick={() => {
                    setAvatarUrl("");
                    setAvatarSeed(Math.random().toString(36).slice(2, 9));
                  }}
                  className="shrink-0 rounded-xl border border-line px-3 text-xs text-white transition hover:border-white/40 hover:text-white"
                >
                  Shuffle
                </button>
              </div>
            </div>
            <div>
              <label className={LABEL} htmlFor="avatar-url">
                Or an image URL
              </label>
              <input
                id="avatar-url"
                className={FIELD}
                value={avatarUrl}
                onChange={(event) => setAvatarUrl(event.target.value)}
                placeholder="https://… (leave empty for an emblem)"
              />
            </div>
          </div>

          <div className="mt-4">
            <span className={LABEL}>Accent</span>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAccent(color)}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    accent.toLowerCase() === color.toLowerCase() ? "border-white" : "border-transparent"
                  }`}
                  style={{ background: color, boxShadow: `0 0 18px -4px ${color}` }}
                  aria-label={`Use accent ${color}`}
                />
              ))}
              <input
                value={accent}
                onChange={(event) => setAccent(event.target.value)}
                className="w-24 rounded-lg border border-line bg-ink/60 px-2 py-1 font-mono text-[11px] text-white uppercase focus:border-lime/40 focus:outline-none"
                aria-label="Custom accent hex"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
          <h2 className="text-sm font-semibold text-white">Personality dials</h2>
          <p className="mt-0.5 text-xs text-muted">These tune the system prompt and the built-in reply style.</p>
          <div className="mt-4 space-y-5">
            {[
              { label: "Warmth", low: "Detached", high: "Devoted", value: warmth, set: setWarmth },
              { label: "Chaos", low: "Steady", high: "Unhinged", value: chaos, set: setChaos },
              { label: "Wit", low: "Plain", high: "Razor-sharp", value: wit, set: setWit },
            ].map((dial) => (
              <div key={dial.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-white/85">{dial.label}</span>
                  <span className="font-mono text-muted">{dial.value}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={dial.value}
                  onChange={(event) => dial.set(Number(event.target.value))}
                  className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10"
                  style={{ accentColor: accent }}
                />
                <div className="mt-1 flex justify-between text-[10px] text-muted/70">
                  <span>{dial.low}</span>
                  <span>{dial.high}</span>
                </div>
              </div>
            ))}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-white/85">Temperature</span>
                <span className="font-mono text-muted">{temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={temperature}
                onChange={(event) => setTemperature(Number(event.target.value))}
                className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10"
                style={{ accentColor: accent }}
              />
              <p className="mt-1 text-[10px] text-muted/70">Lower is consistent, higher is unpredictable.</p>
            </div>
          </div>

          <div className="mt-5">
            <span className={LABEL}>Vibe tags · up to 6</span>
            <div className="flex flex-wrap gap-1.5">
              {VIBE_TAGS.map((tag) => {
                const active = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                      active
                        ? "border-lime/50 bg-lime/15 text-lime"
                        : "border-line bg-white/[0.02] text-muted hover:text-white"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={customTag}
                onChange={(event) => setCustomTag(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCustomTag();
                  }
                }}
                className={FIELD}
                placeholder="Add a custom tag"
              />
              <button
                type="button"
                onClick={addCustomTag}
                className="shrink-0 rounded-xl border border-line px-3 text-xs text-white transition hover:border-lime/40"
              >
                Add
              </button>
            </div>
            {tags.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px]"
                    style={{ borderColor: `${accent}55`, color: accent, background: `${accent}14` }}
                  >
                    {tag}
                    <button type="button" onClick={() => toggleTag(tag)} aria-label={`Remove ${tag}`}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-line/70 bg-panel/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Voice &amp; script</h2>
              <p className="mt-0.5 text-xs text-muted">The opening line, icebreakers and the actual system prompt.</p>
            </div>
            <button
              type="button"
              onClick={autofillPersona}
              className="inline-flex items-center gap-1.5 rounded-xl border border-lime/30 bg-lime/[0.08] px-3 py-2 text-[11px] font-medium text-lime transition hover:bg-lime/15"
            >
              <SparkIcon width={13} height={13} /> Draft from dials
            </button>
          </div>

          <div className="mt-4">
            <label className={LABEL} htmlFor="bot-greeting">
              Opening line
            </label>
            <textarea
              id="bot-greeting"
              className={`${FIELD} min-h-20 resize-y`}
              value={greeting}
              maxLength={400}
              onChange={(event) => setGreeting(event.target.value)}
              placeholder="What's the first thing they say when a chat opens?"
            />
          </div>

          <div className="mt-4">
            <span className={LABEL}>Conversation starters</span>
            <div className="space-y-2">
              {starters.map((starter, index) => (
                <input
                  key={index}
                  className={FIELD}
                  value={starter}
                  onChange={(event) => {
                    const next = [...starters];
                    next[index] = event.target.value;
                    setStarters(next);
                  }}
                  placeholder={`Icebreaker ${index + 1}`}
                />
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className={LABEL} htmlFor="bot-persona">
              System prompt
            </label>
            <textarea
              id="bot-persona"
              className={`${FIELD} min-h-40 resize-y font-mono text-[12px] leading-relaxed`}
              value={persona}
              maxLength={4000}
              onChange={(event) => setPersona(event.target.value)}
              placeholder="You are… You speak like… You care about… Never…"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted/70">
              <span>Leave empty to auto-write from the dials on save.</span>
              <span>{persona.length}/4000</span>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className={LABEL} style={{ marginBottom: 0 }}>
              Visibility
            </span>
            <div className="flex overflow-hidden rounded-xl border border-line">
              {["public", "private"].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setVisibility(option)}
                  className={`px-3 py-1.5 text-[11px] capitalize transition ${
                    visibility === option ? "bg-lime text-ink" : "bg-transparent text-muted hover:text-white"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:h-fit">
        <div className="rounded-2xl border border-line/70 bg-panel/50 p-4">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Live preview</p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-line/70 bg-ink/70">
            <div
              className="h-16 w-full"
              style={{
                backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px), radial-gradient(90% 160% at 20% 0%, rgba(255,255,255,0.14), transparent 64%), linear-gradient(120deg, #191c20, #08090b)`,
                backgroundSize: "26px 26px, 26px 26px, auto, auto",
              }}
            />
            <div className="-mt-7 px-4 pb-4">
              <Avatar bot={previewBot} size={62} online className="border-2 border-ink" />
              <div className="mt-2 flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-white">{name || "Untitled bot"}</p>
                <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] text-muted">
                  {visibility}
                </span>
              </div>
              <p className="truncate font-mono text-[10px] text-muted">@{handleify(name || "new-bot")}</p>
              <p className="mt-1 line-clamp-2 text-[11px] text-white/60">
                {tagline || "A one-line tagline will show up here."}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(tags.length ? tags : ["vibe", "personality"]).slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border px-1.5 py-0.5 text-[9px]"
                    style={{ borderColor: `${accent}44`, color: accent }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-3 rounded-xl rounded-tl-sm border border-line/70 bg-panel/80 px-2.5 py-2 text-[11px] leading-relaxed text-white/75">
                {greeting || `Hi, I'm ${name || "your new bot"}. Tell me something interesting.`}
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
                <span>warmth {warmth}</span>
                <span>chaos {chaos}</span>
                <span>wit {wit}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving || deleting}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft disabled:opacity-60"
          >
            {saving ? "Saving…" : saved ? "Saved" : mode === "edit" ? "Save changes" : "Create bot"}
          </button>
          {error ? <p className="mt-2 text-[11px] text-red-300">{error}</p> : null}
          <p className="mt-2 text-center text-[10px] text-muted/70">
            Stored in your local Postgres. No upload, no account.
          </p>

          {mode === "edit" && bot ? (
            <div className="mt-4 border-t border-line/70 pt-4">
              <Link
                href={`/bots/${bot.handle}`}
                className="block rounded-xl border border-line px-3 py-2 text-center text-[11px] text-white transition hover:border-white/25"
              >
                View profile
              </Link>
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-400/20 px-3 py-2 text-[11px] text-red-300 transition hover:border-red-400/50 hover:bg-red-500/10 disabled:opacity-50"
              >
                <TrashIcon width={12} height={12} /> {deleting ? "Deleting…" : "Delete bot"}
              </button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
