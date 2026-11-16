/**
 * Timezone helpers built on Intl.DateTimeFormat (no dependency).
 * Used for autopilot quiet hours and the "actions today" window, so both
 * follow the user's configured timezone instead of the server's.
 */

export const DEFAULT_TIME_ZONE = "UTC";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** True for an IANA timezone name this runtime knows, e.g. "Africa/Johannesburg". */
export function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim() || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The given timezone if valid, otherwise UTC. */
export function safeTimeZone(value: unknown): string {
  return isValidTimeZone(value) ? (value as string) : DEFAULT_TIME_ZONE;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Wall-clock date and time of `date` as seen in `timeZone`. */
export function localParts(date: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(safeTimeZone(timeZone)).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Hour of the day (0-23) of `date` in `timeZone`. */
export function localHour(date: Date, timeZone: string): number {
  return localParts(date, timeZone).hour;
}

/** Milliseconds that `timeZone` is ahead of UTC at the instant `date`. */
function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which the local calendar day containing `date` began in
 * `timeZone` (local midnight). Correct across daylight-saving changes, where
 * the offset at midnight differs from the offset at `date`.
 */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const p = localParts(date, zone);
  const midnightAsUtc = Date.UTC(p.year, p.month - 1, p.day);
  // First guess uses the offset at `date`; the second pass corrects it with
  // the offset that actually applied at local midnight.
  let instant = midnightAsUtc - offsetMs(date, zone);
  instant = midnightAsUtc - offsetMs(new Date(instant), zone);
  return new Date(instant);
}

/** Autopilot quiet hours: 01:00 up to (not including) 07:00 local time. */
export const QUIET_START_HOUR = 1;
export const QUIET_END_HOUR = 7;

export function isQuietHour(date: Date, timeZone: string): boolean {
  const hour = localHour(date, timeZone);
  return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}
