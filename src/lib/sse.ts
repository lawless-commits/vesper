/**
 * Minimal server-sent-events helpers shared by the chat route (encoding) and
 * ChatView (decoding). Pure functions, safe to import on both sides.
 */

export type ServerEvent = { event: string; data: string };

/** Serialise one event. `data` is JSON-encoded onto a single line. */
export function encodeServerEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Incremental SSE decoder. Feed it text chunks as they arrive (they can split
 * anywhere, including mid-line); it returns the events completed so far.
 */
export function createServerEventParser() {
  let buffer = "";
  return {
    feed(chunk: string): ServerEvent[] {
      buffer += chunk.replace(/\r\n/g, "\n");
      const events: ServerEvent[] = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length) events.push({ event, data: data.join("\n") });
        boundary = buffer.indexOf("\n\n");
      }
      return events;
    },
  };
}

/** Read a fetch response body as a stream of server-sent events. */
export async function* readServerEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createServerEventParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.feed(decoder.decode(value, { stream: true }));
    }
    yield* parser.feed(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
