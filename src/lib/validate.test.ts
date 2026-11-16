import { describe, expect, it } from "vitest";
import { sanitizeAvatar, sanitizeBaseUrl } from "@/lib/validate";

describe("sanitizeAvatar", () => {
  it("accepts presets, root-relative paths, https and image data URLs", () => {
    for (const value of [
      "preset:orbit",
      "/avatars/a.png",
      "https://example.com/a.png",
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/jpeg;base64,/9j/4AAQ",
      "data:image/webp;base64,UklGRg==",
      "data:image/gif;base64,R0lGODlh",
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
      "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
    ]) {
      expect(sanitizeAvatar(value), value).toBe(value);
    }
    expect(sanitizeAvatar("  https://example.com/a.png  ")).toBe("https://example.com/a.png");
  });

  it("rejects http, other schemes and non-image data", () => {
    for (const value of [
      "http://example.com/a.png",
      "//example.com/a.png",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.com/a.png",
      "data:text/html,<script>alert(1)</script>",
      "data:image/bmp;base64,Qk0=",
      "data:image/pngx;base64,AAAA",
      "example.com/a.png",
      "https://",
      "",
      "   ",
    ]) {
      expect(sanitizeAvatar(value), value).toBeNull();
    }
    for (const value of [null, undefined, 42, {}, ["preset:orbit"]]) {
      expect(sanitizeAvatar(value)).toBeNull();
    }
  });

  it("enforces length limits without truncating", () => {
    const fits = `data:image/png;base64,${"A".repeat(200_000)}`;
    expect(sanitizeAvatar(fits)).toBe(fits);
    expect(sanitizeAvatar(`data:image/png;base64,${"A".repeat(300_000)}`)).toBeNull();
    expect(sanitizeAvatar(`https://example.com/${"a".repeat(2000)}`)).toBeNull();
  });
});

describe("sanitizeBaseUrl", () => {
  it("accepts http and https", () => {
    expect(sanitizeBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
    expect(sanitizeBaseUrl(" https://llm.example.com ")).toBe("https://llm.example.com");
  });

  it("rejects other schemes and junk", () => {
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "ftp://host/x", "127.0.0.1:11434", "not a url", "", null, 7]) {
      expect(sanitizeBaseUrl(value), String(value)).toBeNull();
    }
  });
});
