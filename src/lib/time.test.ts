import { describe, expect, it } from "vitest";
import { isQuietHour, isValidTimeZone, localHour, safeTimeZone, startOfLocalDay } from "@/lib/time";

const utc = (iso: string) => new Date(iso);

describe("localHour", () => {
  it("converts to the target timezone", () => {
    expect(localHour(utc("2026-11-16T23:30:00Z"), "UTC")).toBe(23);
    expect(localHour(utc("2026-11-16T23:30:00Z"), "Africa/Johannesburg")).toBe(1);
    expect(localHour(utc("2026-11-16T23:30:00Z"), "America/New_York")).toBe(18);
    expect(localHour(utc("2026-07-16T23:30:00Z"), "America/New_York")).toBe(19);
  });

  it("reports midnight as 0, not 24", () => {
    expect(localHour(utc("2026-11-16T22:00:00Z"), "Africa/Johannesburg")).toBe(0);
    expect(localHour(utc("2026-11-16T00:00:00Z"), "UTC")).toBe(0);
  });
});

describe("isQuietHour", () => {
  it("23:30 UTC is quiet in Johannesburg (01:30 local) but not in UTC", () => {
    const at = utc("2026-11-16T23:30:00Z");
    expect(isQuietHour(at, "Africa/Johannesburg")).toBe(true);
    expect(isQuietHour(at, "UTC")).toBe(false);
  });

  it("covers 01:00 up to but not including 07:00 local", () => {
    const zone = "Africa/Johannesburg"; // UTC+2, no daylight saving
    expect(isQuietHour(utc("2026-11-16T22:59:59Z"), zone)).toBe(false); // 00:59
    expect(isQuietHour(utc("2026-11-16T23:00:00Z"), zone)).toBe(true); // 01:00
    expect(isQuietHour(utc("2026-11-17T04:59:59Z"), zone)).toBe(true); // 06:59
    expect(isQuietHour(utc("2026-11-17T05:00:00Z"), zone)).toBe(false); // 07:00
  });

  it("follows New York across daylight saving", () => {
    // 06:30 UTC is 01:30 EST in winter (quiet) and 02:30 EDT in summer (quiet);
    // 11:30 UTC is 06:30 EST in winter (quiet) but 07:30 EDT in summer (not quiet).
    expect(isQuietHour(utc("2026-01-15T06:30:00Z"), "America/New_York")).toBe(true);
    expect(isQuietHour(utc("2026-07-15T06:30:00Z"), "America/New_York")).toBe(true);
    expect(isQuietHour(utc("2026-01-15T11:30:00Z"), "America/New_York")).toBe(true);
    expect(isQuietHour(utc("2026-07-15T11:30:00Z"), "America/New_York")).toBe(false);
  });
});

describe("startOfLocalDay", () => {
  it("is UTC midnight for UTC", () => {
    expect(startOfLocalDay(utc("2026-11-16T15:45:10Z"), "UTC").toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("resets at local midnight in Johannesburg", () => {
    const zone = "Africa/Johannesburg";
    // 21:59 UTC is still 23:59 on the 16th locally.
    expect(startOfLocalDay(utc("2026-11-16T21:59:00Z"), zone).toISOString()).toBe("2026-11-15T22:00:00.000Z");
    // 22:00 UTC is 00:00 on the 17th locally: a new day has begun.
    expect(startOfLocalDay(utc("2026-11-16T22:00:00Z"), zone).toISOString()).toBe("2026-11-16T22:00:00.000Z");
    expect(startOfLocalDay(utc("2026-11-16T23:30:00Z"), zone).toISOString()).toBe("2026-11-16T22:00:00.000Z");
  });

  it("handles the New York spring-forward day (23 hours long)", () => {
    // 8 March 2026: clocks jump 02:00 EST -> 03:00 EDT. Midnight was still EST (UTC-5).
    const zone = "America/New_York";
    expect(startOfLocalDay(utc("2026-03-08T15:00:00Z"), zone).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfLocalDay(utc("2026-03-08T06:30:00Z"), zone).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    // The next day starts 23 hours later, at midnight EDT (UTC-4).
    expect(startOfLocalDay(utc("2026-03-09T15:00:00Z"), zone).toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("handles the New York fall-back day (25 hours long)", () => {
    // 1 November 2026: clocks fall 02:00 EDT -> 01:00 EST. Midnight was still EDT (UTC-4).
    const zone = "America/New_York";
    expect(startOfLocalDay(utc("2026-11-01T15:00:00Z"), zone).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfLocalDay(utc("2026-11-01T05:30:00Z"), zone).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfLocalDay(utc("2026-11-02T15:00:00Z"), zone).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("timezone validation", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone("Africa/Johannesburg")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(safeTimeZone("nope")).toBe("UTC");
    expect(safeTimeZone("America/New_York")).toBe("America/New_York");
  });
});
