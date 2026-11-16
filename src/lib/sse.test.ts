import { describe, expect, it } from "vitest";
import { createServerEventParser, encodeServerEvent, readServerEvents } from "@/lib/sse";

describe("server-sent events", () => {
  it("round-trips an event", () => {
    const parser = createServerEventParser();
    const events = parser.feed(encodeServerEvent("delta", { text: "hi\nthere" }));
    expect(events).toEqual([{ event: "delta", data: JSON.stringify({ text: "hi\nthere" }) }]);
    expect(JSON.parse(events[0].data)).toEqual({ text: "hi\nthere" });
  });

  it("handles chunks split at arbitrary points", () => {
    const wire = encodeServerEvent("user", { id: 1 }) + encodeServerEvent("delta", { text: "a" }) + encodeServerEvent("done", {});
    for (let size = 1; size <= 9; size += 1) {
      const parser = createServerEventParser();
      const names: string[] = [];
      for (let i = 0; i < wire.length; i += size) {
        for (const event of parser.feed(wire.slice(i, i + size))) names.push(event.event);
      }
      expect(names, `chunk size ${size}`).toEqual(["user", "delta", "done"]);
    }
  });

  it("ignores comments and incomplete trailing data, accepts CRLF", () => {
    const parser = createServerEventParser();
    expect(parser.feed(": keep-alive\n\n")).toEqual([]);
    expect(parser.feed("event: delta\r\ndata: {}\r\n\r\nevent: done\ndata: {")).toEqual([{ event: "delta", data: "{}" }]);
  });

  it("reads events from a byte stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const wire = encodeServerEvent("delta", { text: "héllo" }) + encodeServerEvent("done", { ok: true });
        const bytes = encoder.encode(wire);
        controller.enqueue(bytes.slice(0, 27)); // splits inside the multi-byte "é"
        controller.enqueue(bytes.slice(27));
        controller.close();
      },
    });
    const seen: string[] = [];
    for await (const event of readServerEvents(stream)) seen.push(`${event.event}:${event.data}`);
    expect(seen).toEqual([`delta:{"text":"héllo"}`, `done:{"ok":true}`]);
  });
});
