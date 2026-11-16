import { describe, expect, it } from "vitest";
import { isSameOrigin, secretMatches } from "@/lib/http";

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
