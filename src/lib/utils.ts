export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function handleify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 28) || "new-bot"
  );
}

export function timeAgo(input: Date | string | number) {
  const date = input instanceof Date ? input : new Date(input);
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, max = 140) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export const VIBE_TAGS = [
  "chaotic",
  "cozy",
  "noir",
  "sci-fi",
  "philosophy",
  "coding",
  "music",
  "goth",
  "wellness",
  "worldbuilding",
  "film",
  "gaming",
] as const;

export function traitLabel(value: number, low: string, high: string) {
  if (value < 34) return low;
  if (value > 66) return high;
  return "balanced";
}
