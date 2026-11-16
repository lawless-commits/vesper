export const ACCENTS = [
  "#c9f954",
  "#7dd3fc",
  "#fca5a5",
  "#c4b5fd",
  "#fdba74",
  "#5eead4",
  "#f9a8d4",
  "#a3e635",
] as const;

export type GlyphPresetId =
  | "slash"
  | "orbit"
  | "chevron"
  | "prism"
  | "aperture"
  | "blade"
  | "lattice"
  | "signal";

export type GlyphPreset = {
  id: GlyphPresetId;
  label: string;
};

export const GLYPH_PRESETS: GlyphPreset[] = [
  { id: "slash", label: "Slash" },
  { id: "orbit", label: "Orbit" },
  { id: "chevron", label: "Chevron" },
  { id: "prism", label: "Prism" },
  { id: "aperture", label: "Aperture" },
  { id: "blade", label: "Blade" },
  { id: "lattice", label: "Lattice" },
  { id: "signal", label: "Signal" },
];

/** Monochrome, centered glyph geometry (drawn inside a translated group). */
const MARKS: Record<GlyphPresetId, string> = {
  slash: `
    <path d="M-30 40 L4 -40 H28 L-6 40 Z" fill="#f2f3ef"/>
    <path d="M12 40 L46 -40" stroke="rgba(242,243,239,0.32)" stroke-width="3"/>
  `,
  orbit: `
    <circle r="36" fill="none" stroke="#f2f3ef" stroke-width="4" stroke-dasharray="158 68" transform="rotate(-38)"/>
    <circle cx="28" cy="-26" r="9" fill="#f2f3ef"/>
    <circle r="14" fill="none" stroke="rgba(242,243,239,0.28)" stroke-width="1.5"/>
  `,
  chevron: `
    <path d="M-36 8 L0 -28 L36 8" fill="none" stroke="#f2f3ef" stroke-width="9" stroke-linejoin="miter" stroke-linecap="square"/>
    <path d="M-36 32 L0 -4 L36 32" fill="none" stroke="rgba(242,243,239,0.34)" stroke-width="4"/>
  `,
  prism: `
    <path d="M0 -40 L38 30 H-38 Z" fill="none" stroke="#f2f3ef" stroke-width="6" stroke-linejoin="miter"/>
    <path d="M0 -8 L20 26 H-20 Z" fill="#f2f3ef"/>
  `,
  aperture: `
    <path d="M0 -38 L33 -19 L33 19 L0 38 L-33 19 L-33 -19 Z" fill="none" stroke="#f2f3ef" stroke-width="5" stroke-linejoin="miter"/>
    <path d="M-33 -19 L0 0 L33 -19 M0 38 L0 0" fill="none" stroke="rgba(242,243,239,0.34)" stroke-width="3"/>
  `,
  blade: `
    <path d="M0 -42 L30 0 L0 42 L-30 0 Z" fill="none" stroke="#f2f3ef" stroke-width="5" stroke-linejoin="miter"/>
    <path d="M-30 0 H30" stroke="rgba(242,243,239,0.38)" stroke-width="2"/>
    <path d="M0 -42 V42" stroke="rgba(242,243,239,0.2)" stroke-width="2"/>
  `,
  lattice: `
    <g fill="#f2f3ef">
      <circle cx="-26" cy="-26" r="4.5" opacity="0.55"/>
      <circle cx="0" cy="-26" r="4.5" opacity="0.3"/>
      <circle cx="26" cy="-26" r="4.5" opacity="0.55"/>
      <circle cx="-26" cy="0" r="4.5" opacity="0.3"/>
      <circle cx="0" cy="0" r="7"/>
      <circle cx="26" cy="0" r="4.5" opacity="0.3"/>
      <circle cx="-26" cy="26" r="4.5" opacity="0.55"/>
      <circle cx="0" cy="26" r="4.5" opacity="0.3"/>
      <circle cx="26" cy="26" r="4.5" opacity="0.55"/>
    </g>
    <path d="M-38 -30 V-38 H-30 M30 -38 H38 V-30 M38 30 V38 H30 M-30 38 H-38 V30" fill="none" stroke="rgba(242,243,239,0.35)" stroke-width="2"/>
  `,
  signal: `
    <g fill="#f2f3ef">
      <rect x="-32" y="0" width="8" height="26" rx="2"/>
      <rect x="-16" y="-18" width="8" height="44" rx="2"/>
      <rect x="0" y="-6" width="8" height="32" rx="2"/>
      <rect x="16" y="-30" width="8" height="56" rx="2" opacity="0.55"/>
      <rect x="32" y="-12" width="8" height="38" rx="2" opacity="0.35"/>
    </g>
  `,
};

const MARK_IDS = Object.keys(MARKS) as GlyphPresetId[];

function hashSeed(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 7;
}

function markFor(seed: string, presetId?: string | null): GlyphPresetId {
  if (presetId && (MARK_IDS as string[]).includes(presetId)) return presetId as GlyphPresetId;
  // Seeds ending in "-N" are generated variants of one base: step the glyph
  // deterministically so a variant row always shows four distinct marks.
  const variant = /^(.*)-(\d+)$/.exec(seed);
  if (variant) {
    const base = hashSeed(variant[1]);
    return MARK_IDS[(base + Number(variant[2]) * 3) % MARK_IDS.length];
  }
  return MARK_IDS[hashSeed(seed) % MARK_IDS.length];
}

/**
 * Grok-style monochrome emblem avatar: near-black plate, hairline rings,
 * registration ticks and a single sharp white geometric mark.
 * Fully deterministic from the seed, so no files or uploads are needed.
 */
export function glyphAvatar(seed: string, presetId?: string | null) {
  const cleanSeed = seed || "vesper";
  const h = hashSeed(cleanSeed);
  const mark = markFor(cleanSeed, presetId);
  const rotation = ((h >> 4) % 25) - 12;
  const scale = 0.96 + ((h >> 9) % 11) / 100;
  const tickAngles = [0, 90, 180, 270];

  const ticks = tickAngles
    .map(
      (angle) =>
        `<line x1="120" y1="22" x2="120" y2="30" transform="rotate(${angle} 120 120)" stroke="rgba(255,255,255,0.2)" stroke-width="1.25"/>`,
    )
    .join("");
  const dots = tickAngles
    .map(
      (angle) =>
        `<circle cx="120" cy="94" r="1.8" transform="rotate(${angle + 45} 120 120)" fill="rgba(255,255,255,0.34)"/>`,
    )
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <defs>
    <radialGradient id="plate" cx="32%" cy="18%" r="88%">
      <stop offset="0%" stop-color="#1b1d20"/>
      <stop offset="52%" stop-color="#101214"/>
      <stop offset="100%" stop-color="#07080a"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.1"/>
      <stop offset="70%" stop-color="#ffffff" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="240" height="240" fill="url(#plate)"/>
  <circle cx="120" cy="120" r="96" fill="url(#halo)"/>
  <circle cx="120" cy="120" r="76" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1.25"/>
  <circle cx="120" cy="120" r="86" fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>
  ${ticks}
  ${dots}
  <g transform="translate(120 120) rotate(${rotation}) scale(${scale.toFixed(2)})">
    ${MARKS[mark]}
  </g>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function presetAvatarUrl(id: string) {
  return `preset:${id}`;
}

export function isPresetAvatar(url?: string | null) {
  return Boolean(url && url.startsWith("preset:"));
}

export function botAvatar(bot: {
  name?: string;
  avatarUrl?: string | null;
  avatarSeed?: string | null;
}) {
  const url = bot.avatarUrl?.trim();
  const seed = bot.avatarSeed || bot.name || "vesper";
  if (url && url.startsWith("preset:")) return glyphAvatar(seed, url.slice("preset:".length));
  if (url) return url;
  return glyphAvatar(seed);
}


export function accentAlpha(accent: string, alpha: number) {
  const hex = accent.replace("#", "");
  const value = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(value.slice(0, 2), 16) || 201;
  const g = parseInt(value.slice(2, 4), 16) || 249;
  const b = parseInt(value.slice(4, 6), 16) || 84;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
