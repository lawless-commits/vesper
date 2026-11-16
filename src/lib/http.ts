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

/** Largest value a Postgres `serial` / `integer` id column can hold. */
const MAX_ID = 2_147_483_647;

/**
 * Parse a database id from a URL segment, query parameter or JSON body.
 * Returns a positive integer that fits a Postgres integer column, or null.
 * Only canonical forms are accepted: 12 or "12", but not "1.5", "-3", "",
 * "007", "1e3" or anything too large to be a real id.
 */
export function parseId(value: unknown): number | null {
  let id: number;
  if (typeof value === "number") {
    id = value;
  } else if (typeof value === "string" && /^[1-9]\d{0,9}$/.test(value)) {
    id = Number(value);
  } else {
    return null;
  }
  return Number.isInteger(id) && id >= 1 && id <= MAX_ID ? id : null;
}

/** 400 response in the API's standard `{ error }` shape. */
export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** 404 response in the API's standard `{ error }` shape. */
export function notFound(message: string) {
  return Response.json({ error: message }, { status: 404 });
}
