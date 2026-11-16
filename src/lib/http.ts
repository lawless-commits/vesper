import { timingSafeEqual } from "node:crypto";

/**
 * True when the request was made by a page served from this same origin
 * (the app's own UI), as opposed to curl, cron or another site.
 *
 * Browsers set `Sec-Fetch-Site` themselves and page scripts cannot override
 * it, so it is trusted when present. Older browsers fall back to comparing
 * the `Origin` host with the `Host` header.
 */
export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/** Constant-time comparison of a caller-supplied secret with the expected one. */
export function secretMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
