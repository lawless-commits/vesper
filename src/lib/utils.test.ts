import { describe, expect, it } from "vitest";
import { clamp, handleify, truncate } from "@/lib/utils";

describe("utils", () => {
  it("clamps into range", () => {
    expect(clamp(140)).toBe(100);
    expect(clamp(-3)).toBe(0);
    expect(clamp(42)).toBe(42);
  });

  it("builds url-safe handles", () => {
    expect(handleify("  Night Owl!! ")).toBe("night-owl");
    expect(handleify("***")).toBe("new-bot");
  });

  it("truncates with an ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});
