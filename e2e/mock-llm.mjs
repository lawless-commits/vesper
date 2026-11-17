// Fake Ollama + OpenAI-compatible model server for e2e checks, on port 11999.
// OpenAI routes require "Authorization: Bearer sk-test-123".
// Model names change behaviour: "slow" (60s before answering), "nostream"
// (ignores stream:true), "long" (80 words), "dies" (drops mid-stream).
import http from "node:http";

const KEY = "sk-test-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (n, tag) => Array.from({ length: n }, (_, i) => (i === 0 ? `[${tag}]` : `word${i}`));

http
  .createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const json = (code, data) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const isOpenAi = req.url.startsWith("/v1/");
    if (isOpenAi && req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: "bad key" });
    if (req.url === "/v1/models") return json(200, { data: [{ id: "mock" }, { id: "slow" }] });
    if (req.url === "/api/tags") return json(200, { models: [{ name: "mock" }] });
    const model = body.model ?? "mock";
    const limit = isOpenAi ? body.max_tokens : body.options?.num_predict;
    const last = body.messages?.at(-1)?.content ?? "";
    const tag = `${isOpenAi ? "openai" : "ollama"} limit=${limit} heard="${String(last).slice(0, 40)}"`;
    const list = words(model === "long" ? 80 : 12, tag);
    if (model === "slow") await sleep(60_000);
    const stream = body.stream === true && model !== "nostream";
    if (req.url === "/v1/chat/completions") {
      if (!stream) return json(200, { choices: [{ message: { content: list.join(" ") } }] });
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const [i, w] of list.entries()) {
        if (res.destroyed) return;
        if (model === "dies" && i === 5) return res.destroy();
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: (i ? " " : "") + w } }] })}\n\n`);
        await sleep(120);
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    if (req.url === "/api/chat") {
      if (!stream) return json(200, { message: { content: list.join(" ") }, done: true });
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (const [i, w] of list.entries()) {
        if (res.destroyed) return;
        if (model === "dies" && i === 5) return res.destroy();
        res.write(JSON.stringify({ message: { content: (i ? " " : "") + w }, done: false }) + "\n");
        await sleep(120);
      }
      res.write(JSON.stringify({ message: { content: "" }, done: true }) + "\n");
      return res.end();
    }
    json(404, { error: "not found" });
  })
  .listen(11999, "127.0.0.1", () => console.log("mock model server on 127.0.0.1:11999"));
