import { describe, expect, it, vi } from "vitest";

// autopilot.ts imports the database; this test only needs its pure helper.
vi.mock("@/db", () => ({ db: {}, pool: {} }));

const { trimModelText } = await import("@/lib/autopilot");

describe("trimModelText", () => {
  it("strips wrapping quotes and collapses whitespace", () => {
    expect(trimModelText('  "Hello\n\n there."  ', 100)).toBe("Hello there.");
  });

  it("cuts at a sentence end when over the cap", () => {
    const text = "First sentence is here. Second sentence is also here. Third one runs long.";
    expect(trimModelText(text, 60)).toBe("First sentence is here. Second sentence is also here.");
  });

  it("falls back to an ellipsis when there is no sentence break", () => {
    const out = trimModelText("word ".repeat(100), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty for empty output", () => {
    expect(trimModelText('  ""  ', 50)).toBe("");
  });
});
