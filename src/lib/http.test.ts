import { describe, expect, it } from "vitest";
import { badRequest, isSameOrigin, parseId, secretMatches } from "@/lib/http";

function req(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/automation/run", { method: "POST", headers });
}

describe("isSameOrigin", () => {
  it("accepts Sec-Fetch-Site: same-origin", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("rejects other Sec-Fetch-Site values even when Origin matches", () => {
    for (const value of ["cross-site", "same-site", "none"]) {
      expect(
        isSameOrigin(req({ "sec-fetch-site": value, origin: "http://localhost:3000", host: "localhost:3000" })),
      ).toBe(false);
    }
  });

  it("falls back to Origin host === Host", () => {
    expect(isSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "http://LOCALHOST:3000", host: "localhost:3000" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "http://evil.test", host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "http://localhost:4000", host: "localhost:3000" }))).toBe(false);
  });

  it("rejects requests with no browser headers (curl, cron)", () => {
    expect(isSameOrigin(req({}))).toBe(false);
    expect(isSameOrigin(req({ host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null", host: "localhost:3000" }))).toBe(false);
  });
});

describe("secretMatches", () => {
  it("matches only the exact secret", () => {
    expect(secretMatches("secret", "secret")).toBe(true);
    expect(secretMatches("secreT", "secret")).toBe(false);
    expect(secretMatches("secret1", "secret")).toBe(false);
    expect(secretMatches("", "secret")).toBe(false);
    expect(secretMatches(null, "secret")).toBe(false);
    expect(secretMatches("secret", "")).toBe(false);
  });
});

describe("parseId", () => {
  it("accepts canonical positive integers", () => {
    expect(parseId("12")).toBe(12);
    expect(parseId(12)).toBe(12);
    expect(parseId("1")).toBe(1);
    expect(parseId("2147483647")).toBe(2147483647);
  });

  it("rejects everything else", () => {
    for (const value of ["abc", "1.5", "-3", "", "007", "999999999999999999", "0", " 12", "12 ", "1e3", "0x10", "2147483648"]) {
      expect(parseId(value), JSON.stringify(value)).toBeNull();
    }
    for (const value of [0, -3, 1.5, NaN, Infinity, 2147483648, null, undefined, true, [12], { id: 12 }]) {
      expect(parseId(value), String(value)).toBeNull();
    }
  });
});

describe("badRequest", () => {
  it("returns 400 with a JSON error", async () => {
    const response = badRequest("Bad id");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Bad id" });
  });
});
