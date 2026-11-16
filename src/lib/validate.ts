/** Input validation shared by API routes. Pure functions, no database access. */

const MAX_URL_LENGTH = 2000;
/** ~190 KB of image once base64-decoded; enough for an avatar, small enough for a text column. */
const MAX_DATA_URL_LENGTH = 256_000;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/i;

/**
 * Validate an avatar value from user input. Returns the value to store, or
 * null (which renders the default generated emblem).
 *
 * Allowed: `preset:<id>`, root-relative paths (`/avatars/a.png`), `https://`
 * URLs, and `data:image/` URLs for png, jpeg, webp, gif or svg+xml.
 * Not allowed: `http://` (mixed content, and it makes the browser fetch
 * remote images over an unencrypted connection), protocol-relative `//host`,
 * and any other scheme. Over-long values are rejected rather than truncated,
 * because a truncated data URL is a broken image.
 *
 * This only applies to new input; avatars already stored are left alone.
 */
export function sanitizeAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (DATA_IMAGE.test(raw)) return raw.length <= MAX_DATA_URL_LENGTH ? raw : null;
  if (raw.length > MAX_URL_LENGTH) return null;
  if (raw.startsWith("preset:")) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (raw.startsWith("https://")) {
    try {
      return new URL(raw).protocol === "https:" ? raw : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Validate a model server base URL. Returns the trimmed URL, or null unless
 * it parses and uses http: or https: (so no file:, javascript:, ftp: ...).
 */
export function sanitizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}
