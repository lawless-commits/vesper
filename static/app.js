// Vesper client script. Pages are rendered by the Rust server; this file
// adds the interactive parts through data-* attributes. No framework, no build.
"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function readJson(id) {
  const node = document.getElementById(id);
  if (!node) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

/** fetch() a JSON API. Resolves to { ok, status, data } and never throws for HTTP errors. */
async function api(method, url, body, init = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, data };
}

function show(node, visible, display = "block") {
  if (!node) return;
  node.classList.toggle("hidden", !visible);
  if (visible && display !== "block") node.classList.add(display);
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked; the setting simply does not persist.
  }
}

function avatarSrc(avatarUrl, seed, name) {
  const cleanSeed = seed || name || "vesper";
  const url = (avatarUrl || "").trim();
  const params = new URLSearchParams({ seed: cleanSeed });
  if (url.startsWith("preset:")) {
    params.set("preset", url.slice("preset:".length));
    return `/avatar.svg?${params}`;
  }
  return url || `/avatar.svg?${params}`;
}

function handleify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 28) || "new-bot"
  );
}

// ---------------------------------------------------------------- shell

function initShell() {
  const menu = $("#mobile-menu");
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-menu-open]")) show(menu, true);
    else if (event.target.closest("[data-menu-close]")) show(menu, false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") show(menu, false);
  });

  // "Start chatting" / "Send this": open a new thread, then go to it.
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-start-chat]");
    if (!button || button.disabled) return;
    const label = $("[data-label]", button);
    const error = button.parentElement && $("[data-error]", button.parentElement);
    const original = label ? label.textContent : "";
    button.disabled = true;
    if (label) label.textContent = "Opening chat…";
    show(error, false);
    try {
      const { ok, data } = await api("POST", "/api/conversations", { botId: Number(button.dataset.startChat) });
      if (!ok || !data.conversation) throw new Error(data.error || "Could not open a chat");
      const prompt = button.dataset.prompt;
      window.location.href = `/chats/${data.conversation.id}${prompt ? `?say=${encodeURIComponent(prompt)}` : ""}`;
    } catch (err) {
      button.disabled = false;
      if (label) label.textContent = original;
      if (error) {
        error.textContent = err instanceof Error ? err.message : "Could not open a chat";
        show(error, true);
      }
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-conversation]");
    if (!button) return;
    if (!window.confirm("Delete this chat and its messages? This can't be undone.")) return;
    button.disabled = true;
    const { ok } = await api("DELETE", `/api/conversations/${button.dataset.deleteConversation}`).catch(() => ({ ok: false }));
    if (ok) {
      const row = button.closest("[data-conversation-row]");
      if (row) row.remove();
    } else {
      button.disabled = false;
      window.alert("Couldn't delete that chat. Try again.");
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const source = $("[data-copy-source]", button.closest("div.overflow-hidden") || document);
    const label = $("[data-copy-label]", button);
    try {
      await navigator.clipboard.writeText(source ? source.textContent : "");
      if (label) label.textContent = "copied";
      setTimeout(() => label && (label.textContent = "copy"), 1600);
    } catch {
      // Clipboard can be unavailable outside secure contexts.
    }
  });
}

// ---------------------------------------------------------------- discover

function initRoster() {
  const root = $("[data-roster]");
  if (!root) return;
  const search = $("[data-roster-search]", root);
  const empty = $("[data-roster-empty]", root);
  let tag = "all";

  function apply() {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const card of $$("[data-bot-card]", root)) {
      const tags = (card.dataset.tags || "").split(" ").filter(Boolean);
      const matchesTag = tag === "all" || tags.includes(tag);
      const matchesQuery =
        !query ||
        card.dataset.name.includes(query) ||
        card.dataset.handle.includes(query) ||
        card.dataset.tagline.includes(query) ||
        tags.some((t) => t.includes(query));
      const match = matchesTag && matchesQuery;
      card.classList.toggle("hidden", !match);
      if (match) visible += 1;
    }
    for (const chip of $$("[data-tag-filter]", root)) chip.setAttribute("aria-pressed", String(chip.dataset.tagFilter === tag));
    $("[data-roster-query]", root).textContent = query || tag;
    show(empty, visible === 0);
  }

  root.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-tag-filter]");
    if (!chip) return;
    tag = chip.dataset.tagFilter;
    apply();
  });
  search.addEventListener("input", apply);
  apply();
}

// ---------------------------------------------------------------- chat

function engineLabel(engine) {
  if (!engine || engine === "user") return "";
  if (engine === "vesper-local") return "built-in engine";
  if (engine.startsWith("ollama:")) return `ollama · ${engine.slice(7)}`;
  if (engine.startsWith("openai:")) return `local api · ${engine.slice(7)}`;
  return engine;
}

/** Read a fetch body as server-sent events: yields { event, data }. */
async function* readServerEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) yield { event, data: data.join("\n") };
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function initChat() {
  const root = $("[data-chat]");
  if (!root) return;
  const config = readJson("chat-config");
  const bot = config.bot;
  const list = $("[data-chat-messages]", root);
  const scroller = $("[data-chat-scroll]", root);
  const input = $("[data-chat-input]", root);
  const sendButton = $("[data-chat-send]", root);
  const stopButton = $("[data-chat-stop]", root);
  const typing = $("[data-chat-typing]", root);
  const errorBox = $("[data-chat-error]", root);
  const notice = $("[data-chat-notice]", root);
  const voiceToggle = $("[data-voice-toggle]", root);
  let sending = false;
  let controller = null;
  let voiceOn = storageGet("vesper:voice") === "on";

  const scrollToBottom = (smooth) => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    const clean = text.replace(/\*[^*]{1,80}\*/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean.slice(0, 900));
    utterance.rate = 0.9 + (bot.chaos / 100) * 0.18;
    utterance.pitch = 0.85 + (bot.warmth / 100) * 0.4;
    const preferred = window.speechSynthesis.getVoices().find((voice) => /en-(GB|US)/i.test(voice.lang));
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  }

  function renderVoice() {
    show($("[data-voice-on]", voiceToggle), voiceOn);
    show($("[data-voice-off]", voiceToggle), !voiceOn);
    voiceToggle.setAttribute("aria-label", voiceOn ? "Turn bot voice off" : "Read replies aloud");
    voiceToggle.title = voiceOn ? "Voice on — replies are spoken" : "Read replies aloud";
    voiceToggle.className = `grid h-9 w-9 place-items-center rounded-xl border transition ${
      voiceOn ? "border-lime/40 bg-lime/10 text-lime" : "border-line text-muted hover:text-white"
    }`;
  }
  voiceToggle.addEventListener("click", () => {
    voiceOn = !voiceOn;
    storageSet("vesper:voice", voiceOn ? "on" : "off");
    renderVoice();
    if (voiceOn) speak(`Voice on. I'm ${bot.name}. ${bot.tagline || ""}`);
    else if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  });
  renderVoice();
  window.addEventListener("pagehide", () => "speechSynthesis" in window && window.speechSynthesis.cancel());

  // Bubbles built here mirror the server-rendered ones in pages.rs.
  function userBubble(message) {
    const row = document.createElement("div");
    row.dataset.messageId = message.id;
    row.dataset.role = "user";
    row.className = "animate-rise flex justify-end gap-2.5";
    row.innerHTML = `
      <div class="flex max-w-[85%] flex-col items-end">
        <div data-message-text class="rounded-2xl rounded-br-md bg-lime px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-ink shadow-[0_10px_30px_-16px_rgba(201,249,84,0.8)]"></div>
        <span class="mt-1 pr-1 text-[10px] text-muted"></span>
      </div>
      <span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-panel-2 text-[11px] font-semibold text-white/80"></span>`;
    $("[data-message-text]", row).textContent = message.content;
    row.querySelector("span.text-muted").textContent = config.userName;
    row.lastElementChild.textContent = (config.userName || "Y").slice(0, 1).toUpperCase();
    if (message.failed) row.classList.add("opacity-60");
    return row;
  }

  function botBubble(message) {
    const row = document.createElement("div");
    row.dataset.messageId = message.id;
    row.dataset.role = "assistant";
    row.className = "animate-rise flex gap-2.5";
    row.innerHTML = `
      <span class="relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/12 bg-[#07080a]" style="width:34px;height:34px;border-radius:10px">
        <img class="h-full w-full object-cover" width="34" height="34" alt="">
      </span>
      <div class="group min-w-0 max-w-[86%]">
        <div class="mb-1 flex items-center gap-2">
          <span class="text-xs font-semibold text-white/90"></span>
          <span data-message-engine class="font-mono text-[10px] text-muted/80"></span>
        </div>
        <div data-message-text class="rounded-2xl rounded-tl-md border border-line/80 bg-panel/70 px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-white/85"></div>
        <div class="mt-1 flex items-center gap-2 pl-1 opacity-0 transition group-hover:opacity-100">
          <button type="button" data-message-copy class="flex items-center gap-1 text-[10px] text-muted transition hover:text-white"><span>copy</span></button>
          <button type="button" data-message-speak class="flex items-center gap-1 text-[10px] text-muted transition hover:text-white">speak</button>
          <span class="text-[10px] text-muted/60"></span>
        </div>
      </div>`;
    const img = $("img", row);
    img.src = bot.avatar;
    img.alt = `${bot.name} avatar`;
    row.querySelector(".font-semibold.text-white\\/90").textContent = bot.name;
    row.querySelector(".text-muted\\/60").textContent = `@${bot.handle}`;
    $("[data-message-engine]", row).textContent = engineLabel(message.engine);
    $("[data-message-text]", row).textContent = message.content;
    return row;
  }

  function bubble(message) {
    return message.role === "user" ? userBubble(message) : botBubble(message);
  }

  function setPendingCaret(row, on) {
    const text = $("[data-message-text]", row);
    const existing = $("[data-caret]", text);
    if (on && !existing) {
      const caret = document.createElement("span");
      caret.dataset.caret = "";
      caret.className = "ml-1 inline-block h-3 w-1.5 animate-pulse bg-lime/70 align-middle";
      text.appendChild(caret);
    } else if (!on && existing) {
      existing.remove();
    }
  }

  function renderAll(messages) {
    list.replaceChildren(...messages.map(bubble));
    scrollToBottom(false);
  }

  list.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-message-id]");
    if (!row) return;
    const text = ($("[data-message-text]", row) || {}).textContent || "";
    if (event.target.closest("[data-message-speak]")) speak(text);
    const copy = event.target.closest("[data-message-copy]");
    if (copy) {
      try {
        await navigator.clipboard.writeText(text);
        copy.lastElementChild.textContent = "copied";
        setTimeout(() => (copy.lastElementChild.textContent = "copy"), 1600);
      } catch {
        // ignore
      }
    }
  });

  function setSending(on) {
    sending = on;
    show(sendButton, !on);
    stopButton.classList.toggle("hidden", !on);
    stopButton.classList.toggle("grid", on);
    sendButton.classList.toggle("grid", !on);
    sendButton.disabled = on || !input.value.trim();
  }

  function showError(message) {
    errorBox.textContent = message || "";
    show(errorBox, Boolean(message));
  }

  function showNotice(message) {
    $("[data-chat-notice-text]", notice).textContent = message || "";
    notice.classList.toggle("hidden", !message);
    notice.classList.toggle("flex", Boolean(message));
  }
  $("[data-chat-notice-dismiss]", notice).addEventListener("click", () => showNotice(null));

  /**
   * Replace the transcript with what the server stored. With afterId, wait
   * briefly for an assistant message newer than it (a stopped reply is saved
   * a moment after the browser disconnects).
   */
  async function reconcile(afterId) {
    const attempts = afterId === undefined ? 1 : 8;
    let latest = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        const { ok, data } = await api("GET", `/api/conversations/${config.conversationId}`, undefined, { cache: "no-store" });
        if (!ok) continue;
        latest = data.messages || null;
      } catch {
        continue;
      }
      const last = latest && latest[latest.length - 1];
      if (afterId === undefined || (last && last.role !== "user" && last.id > afterId)) break;
    }
    if (latest) renderAll(latest);
    return latest;
  }

  async function send(raw) {
    const content = raw.trim();
    if (!content || sending) return;
    const starters = $("[data-chat-starters]", root);
    if (starters) starters.remove();
    const pendingUser = userBubble({ id: -Date.now(), content });
    list.appendChild(pendingUser);
    input.value = "";
    resize();
    setSending(true);
    showError(null);
    show(typing, true);
    typing.classList.add("flex");
    scrollToBottom(false);

    controller = new AbortController();
    let savedUserId = null;
    let replyText = "";
    let replyRow = null;
    let finished = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: config.conversationId, content, stream: true }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        if (typeof data.userMessageId === "number") savedUserId = data.userMessageId;
        throw new Error(data.error || "The engine didn't answer.");
      }
      for await (const event of readServerEvents(response.body)) {
        const data = JSON.parse(event.data);
        if (event.event === "user" && data.userMessage) {
          savedUserId = data.userMessage.id;
          pendingUser.dataset.messageId = savedUserId;
        } else if (event.event === "delta" && data.text) {
          replyText += data.text;
          if (!replyRow) {
            typing.classList.add("hidden");
            typing.classList.remove("flex");
            replyRow = botBubble({ id: -1, content: "", engine: "" });
            list.appendChild(replyRow);
          }
          $("[data-message-text]", replyRow).textContent = replyText;
          setPendingCaret(replyRow, true);
          scrollToBottom(false);
        } else if (event.event === "done" && data.reply) {
          finished = true;
          const final = botBubble(data.reply);
          if (replyRow) replyRow.replaceWith(final);
          else list.appendChild(final);
          if (data.notice) showNotice(data.notice);
          if (voiceOn) speak(data.reply.content);
        } else if (event.event === "error") {
          if (typeof data.userMessageId === "number") savedUserId = data.userMessageId;
          throw new Error(data.error || "The engine didn't answer.");
        }
      }
      if (!finished) throw new Error("The connection closed before the reply finished.");
    } catch (err) {
      const stopped = controller.signal.aborted;
      if (replyRow) setPendingCaret(replyRow, false);
      // Ask the server what it kept. After Stop with partial text, wait for
      // the partial reply to be saved.
      const stored = await reconcile(stopped && replyText && savedUserId !== null ? savedUserId : undefined);
      const userStored =
        savedUserId !== null ||
        Boolean(stored && stored.some((m) => m.role === "user" && m.content === content && m.id > config.lastId));
      if (!stopped) showError(err instanceof Error ? err.message : "Something went wrong.");
      if (!userStored) {
        if (!stored) pendingUser.classList.add("opacity-60");
        input.value = content;
        resize();
      }
    } finally {
      controller = null;
      typing.classList.add("hidden");
      typing.classList.remove("flex");
      setSending(false);
      input.focus();
      scrollToBottom(true);
    }
  }

  function resize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  }

  config.lastId = Math.max(0, ...$$("[data-message-id]", list).map((row) => Number(row.dataset.messageId)));
  input.addEventListener("input", () => {
    resize();
    sendButton.disabled = sending || !input.value.trim();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });
  sendButton.addEventListener("click", () => send(input.value));
  stopButton.addEventListener("click", () => controller && controller.abort());
  root.addEventListener("click", (event) => {
    const starter = event.target.closest("[data-starter]");
    if (starter) send(starter.dataset.starter);
  });

  scrollToBottom(false);
  if (config.initialPrompt) {
    window.history.replaceState(null, "", window.location.pathname);
    send(config.initialPrompt);
  } else {
    input.focus();
  }
}

// ---------------------------------------------------------------- runtime

function initRuntime() {
  const root = $("[data-runtime-form]");
  if (!root) return;
  const { runtime, providers } = readJson("runtime-config");
  const state = {
    provider: runtime.provider,
    hasApiKey: runtime.hasApiKey,
    apiKeySource: runtime.apiKeySource,
    clearApiKey: false,
  };
  const field = (id) => document.getElementById(id);
  const baseUrl = field("base-url");
  const model = field("model");
  const apiKey = field("api-key");
  const timezone = field("timezone");
  const temperature = field("temperature");
  const keyStatus = $("[data-key-status]", root);
  const result = $("[data-runtime-result]", root);
  const saved = $("[data-runtime-saved]", root);
  const error = $("[data-runtime-error]", root);
  const zoneButton = $("[data-use-browser-zone]", root);

  let browserZone = null;
  try {
    browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    browserZone = null;
  }

  function renderProviders() {
    for (const card of $$("[data-provider]", root)) {
      const active = card.dataset.provider === state.provider;
      card.setAttribute("aria-pressed", String(active));
      show($(".provider-dot", card), active);
      $(".provider-active", card).classList.toggle("hidden", !active);
      $(".provider-active", card).classList.toggle("flex", active);
    }
    show($("[data-connection]", root), state.provider !== "demo");
    for (const chip of $$("[data-model]", root)) chip.setAttribute("aria-pressed", String(chip.dataset.model === model.value));
  }

  function renderKey() {
    const fromEnv = state.apiKeySource === "env";
    apiKey.disabled = fromEnv;
    apiKey.placeholder = fromEnv
      ? "Set by LLM_API_KEY in the environment"
      : state.hasApiKey && !state.clearApiKey
        ? "Key saved — leave blank to keep it"
        : "sk-local-…";
    keyStatus.replaceChildren();
    const text = (content, className = "") => {
      const span = document.createElement("span");
      span.textContent = content;
      span.className = className;
      return span;
    };
    const button = (label, onClick, extra) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.className = `rounded-lg border border-line px-2 py-0.5 text-white transition ${extra}`;
      b.addEventListener("click", onClick);
      return b;
    };
    if (fromEnv) {
      keyStatus.append(text("Using the key from the LLM_API_KEY environment variable. It overrides anything saved here."));
    } else if (state.clearApiKey) {
      keyStatus.append(
        text("The saved key will be removed when you save.", "text-amber-200"),
        button("Keep key", () => ((state.clearApiKey = false), renderKey()), "hover:border-white/25"),
      );
    } else if (state.hasApiKey) {
      keyStatus.append(
        text("A key is saved on this machine. It is never shown again.", "text-lime"),
        button("Remove key", () => ((state.clearApiKey = true), (apiKey.value = ""), renderKey()), "hover:border-red-300/50 hover:text-red-200"),
      );
    } else {
      keyStatus.append(text("No key saved."));
    }
  }

  function renderZone() {
    const visible = browserZone && browserZone !== timezone.value.trim();
    zoneButton.textContent = `Use this browser's: ${browserZone}`;
    show(zoneButton, Boolean(visible));
  }

  function payload() {
    const key = apiKey.value.trim();
    return {
      provider: state.provider,
      baseUrl: baseUrl.value,
      model: model.value,
      temperature: Number(temperature.value),
      userName: field("user-name").value,
      timezone: timezone.value.trim() || "UTC",
      timeoutSeconds: Number(field("timeout-seconds").value),
      maxTokens: Number(field("max-tokens").value),
      ...(key ? { apiKey: key } : state.clearApiKey ? { clearApiKey: true } : {}),
    };
  }

  root.addEventListener("click", (event) => {
    const card = event.target.closest("[data-provider]");
    if (card) {
      state.provider = card.dataset.provider;
      if (state.provider !== "demo") {
        const option = providers.find((p) => p.id === state.provider);
        baseUrl.value = option.baseUrl;
        if (!model.value || model.value === "vesper-local-1" || model.value === "local-model") model.value = option.model;
      }
      show(result, false);
      renderProviders();
    }
    const chip = event.target.closest("[data-model]");
    if (chip) {
      model.value = chip.dataset.model;
      renderProviders();
    }
  });
  model.addEventListener("input", renderProviders);
  apiKey.addEventListener("input", () => {
    if (apiKey.value) state.clearApiKey = false;
    renderKey();
  });
  timezone.addEventListener("input", renderZone);
  zoneButton.addEventListener("click", () => {
    timezone.value = browserZone;
    renderZone();
  });
  temperature.addEventListener("input", () => ($("[data-temperature-value]", root).textContent = Number(temperature.value).toFixed(2)));

  const saveButton = $("[data-runtime-save]", root);
  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    $("[data-label]", saveButton).textContent = "Saving…";
    show(error, false);
    show(result, false);
    try {
      const { ok, data } = await api("PUT", "/api/runtime", payload());
      if (!ok || !data.runtime) throw new Error(data.error || "Could not save runtime settings");
      baseUrl.value = data.runtime.baseUrl;
      model.value = data.runtime.model;
      timezone.value = data.runtime.timezone;
      field("timeout-seconds").value = data.runtime.timeoutSeconds;
      field("max-tokens").value = data.runtime.maxTokens;
      state.hasApiKey = data.runtime.hasApiKey;
      state.apiKeySource = data.runtime.apiKeySource;
      state.clearApiKey = false;
      apiKey.value = "";
      saved.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
      show(saved, true);
      renderKey();
      renderZone();
      renderProviders();
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : "Could not save runtime settings";
      show(error, true);
      show(saved, false);
    } finally {
      saveButton.disabled = false;
      $("[data-label]", saveButton).textContent = "Save runtime";
    }
  });

  const testButton = $("[data-runtime-test]", root);
  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    $("[data-label]", testButton).textContent = "Testing…";
    show(result, false);
    let outcome;
    try {
      const { data } = await api("POST", "/api/runtime/test", payload());
      outcome = { ok: Boolean(data.ok), detail: data.detail || "No response" };
    } catch {
      outcome = { ok: false, detail: "Couldn't reach the test endpoint." };
    }
    result.textContent = outcome.detail;
    result.className = `flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
      outcome.ok ? "border-lime/30 bg-lime/[0.07] text-lime" : "border-red-400/30 bg-red-500/10 text-red-200"
    }`;
    testButton.disabled = false;
    $("[data-label]", testButton).textContent = "Test connection";
  });

  renderProviders();
  renderKey();
  renderZone();
}

// ---------------------------------------------------------------- studio

function initStudio() {
  const root = $("[data-studio]");
  if (!root) return;
  const config = readJson("studio-config");
  const field = (id) => document.getElementById(id);
  const name = field("bot-name");
  const tagline = field("bot-tagline");
  const greeting = field("bot-greeting");
  const persona = field("bot-persona");
  const seedInput = field("avatar-seed");
  const urlInput = field("avatar-url");
  const accentInput = field("accent");
  const customTag = field("custom-tag");
  const state = {
    avatarUrl: config.avatarUrl || "",
    avatarSeed: config.avatarSeed || "vesper",
    accent: config.accent || "#c9f954",
    tags: [...config.tags],
    visibility: config.visibility || "public",
  };
  const dialValue = (key) => Number(field(`dial-${key}`).value);

  function render() {
    const displayName = name.value.trim();
    $("[data-studio-handle]", root).textContent = `@${handleify(displayName || "new-bot")}`;
    $("[data-preview-name]", root).textContent = displayName || "Untitled bot";
    $("[data-preview-handle]", root).textContent = `@${handleify(displayName || "new-bot")}`;
    $("[data-preview-tagline]", root).textContent = tagline.value || "A one-line tagline will show up here.";
    $("[data-preview-greeting]", root).textContent =
      greeting.value || `Hi, I'm ${displayName || "your new bot"}. Tell me something interesting.`;
    $("[data-preview-visibility]", root).textContent = state.visibility;
    $("[data-preview-avatar]", root).src = avatarSrc(state.avatarUrl, state.avatarSeed, displayName);
    $("[data-persona-count]", root).textContent = persona.value.length;

    for (const button of $$("[data-preset]", root)) {
      const active = state.avatarUrl === `preset:${button.dataset.preset}`;
      button.setAttribute("aria-pressed", String(active));
      $("[data-pick-check]", button).classList.toggle("hidden", !active);
      $("[data-pick-check]", button).classList.toggle("grid", active);
      $("img", button).src = `/avatar.svg?${new URLSearchParams({ seed: `${button.dataset.preset}-${state.avatarSeed || "vesper"}`, preset: button.dataset.preset })}`;
    }
    // Variants are always "<base>-0".."<base>-3", so picking one keeps the row stable.
    const base = (state.avatarSeed || "vesper").replace(/-\d+$/, "") || "vesper";
    for (const button of $$("[data-variant]", root)) {
      const seed = `${base}-${button.dataset.variant}`;
      button.setAttribute("aria-pressed", String(!state.avatarUrl && state.avatarSeed === seed));
      $("img", button).src = `/avatar.svg?${new URLSearchParams({ seed })}`;
    }
    for (const button of $$("[data-accent]", root)) {
      button.classList.toggle("border-white", button.dataset.accent.toLowerCase() === state.accent.toLowerCase());
      button.classList.toggle("border-transparent", button.dataset.accent.toLowerCase() !== state.accent.toLowerCase());
    }
    for (const button of $$("[data-vibe]", root)) button.setAttribute("aria-pressed", String(state.tags.includes(button.dataset.vibe)));
    for (const button of $$("[data-visibility]", root)) button.setAttribute("aria-pressed", String(button.dataset.visibility === state.visibility));
    for (const range of $$(".studio-range", root)) range.style.accentColor = state.accent;

    const tagList = $("[data-tag-list]", root);
    tagList.replaceChildren(
      ...state.tags.map((tag) => {
        const chip = document.createElement("span");
        chip.className = "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px]";
        chip.style.borderColor = `${state.accent}55`;
        chip.style.color = state.accent;
        chip.style.background = `${state.accent}14`;
        chip.append(tag);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "✕";
        remove.setAttribute("aria-label", `Remove ${tag}`);
        remove.addEventListener("click", () => toggleTag(tag));
        chip.append(remove);
        return chip;
      }),
    );
    const previewTags = $("[data-preview-tags]", root);
    previewTags.replaceChildren(
      ...(state.tags.length ? state.tags : ["vibe", "personality"]).slice(0, 4).map((tag) => {
        const chip = document.createElement("span");
        chip.className = "rounded-full border px-1.5 py-0.5 text-[9px]";
        chip.style.borderColor = `${state.accent}44`;
        chip.style.color = state.accent;
        chip.textContent = tag;
        return chip;
      }),
    );
  }

  function toggleTag(tag) {
    if (state.tags.includes(tag)) state.tags = state.tags.filter((t) => t !== tag);
    else if (state.tags.length < 6) state.tags.push(tag);
    render();
  }

  function addCustomTag() {
    const clean = customTag.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20);
    if (clean && !state.tags.includes(clean) && state.tags.length < 6) state.tags.push(clean);
    customTag.value = "";
    render();
  }

  root.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-preset]");
    if (preset) {
      state.avatarUrl = `preset:${preset.dataset.preset}`;
      state.avatarSeed = state.avatarSeed.replace(/^preset:/, "").replace(/-\d+$/, "") || preset.dataset.preset;
      seedInput.value = state.avatarSeed;
      urlInput.value = "";
    }
    const variant = event.target.closest("[data-variant]");
    if (variant) {
      state.avatarUrl = "";
      urlInput.value = "";
      state.avatarSeed = `${state.avatarSeed.replace(/-\d+$/, "") || "vesper"}-${variant.dataset.variant}`;
      seedInput.value = state.avatarSeed;
    }
    if (event.target.closest("[data-shuffle]")) {
      state.avatarUrl = "";
      urlInput.value = "";
      state.avatarSeed = Math.random().toString(36).slice(2, 9);
      seedInput.value = state.avatarSeed;
    }
    const accent = event.target.closest("[data-accent]");
    if (accent) {
      state.accent = accent.dataset.accent;
      accentInput.value = state.accent;
    }
    const vibe = event.target.closest("[data-vibe]");
    if (vibe) return toggleTag(vibe.dataset.vibe);
    if (event.target.closest("[data-add-tag]")) return addCustomTag();
    const visibility = event.target.closest("[data-visibility]");
    if (visibility) state.visibility = visibility.dataset.visibility;
    render();
  });

  name.addEventListener("input", () => {
    if (config.mode === "create") {
      state.avatarSeed = handleify(name.value);
      seedInput.value = state.avatarSeed;
    }
    render();
  });
  for (const input of [tagline, greeting, persona]) input.addEventListener("input", render);
  seedInput.addEventListener("input", () => {
    state.avatarUrl = "";
    urlInput.value = "";
    state.avatarSeed = seedInput.value;
    render();
  });
  urlInput.addEventListener("input", () => {
    state.avatarUrl = urlInput.value;
    render();
  });
  accentInput.addEventListener("input", () => {
    state.accent = accentInput.value;
    render();
  });
  customTag.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustomTag();
    }
  });
  for (const range of $$("[data-dial]", root)) {
    range.addEventListener("input", () => {
      const key = range.dataset.dial;
      const value = key === "temperature" ? Number(range.value).toFixed(2) : range.value;
      for (const label of $$(`[data-dial-value="${key}"]`, root)) label.textContent = value;
    });
  }

  $("[data-draft]", root).addEventListener("click", async () => {
    const { ok, data } = await api("POST", "/api/studio/draft", {
      name: name.value || "This bot",
      tagline: tagline.value,
      tags: state.tags,
      warmth: dialValue("warmth"),
      chaos: dialValue("chaos"),
      wit: dialValue("wit"),
    }).catch(() => ({ ok: false, data: {} }));
    if (!ok) return;
    persona.value = data.persona;
    if (!greeting.value) greeting.value = `I'm ${name.value || "here"}. ${tagline.value || "Tell me something real."}`;
    const starterInputs = $$("[data-starter-input]", root);
    if (starterInputs.every((input) => !input.value.trim())) {
      starterInputs.forEach((input, index) => (input.value = data.starters[index] || ""));
    }
    render();
  });

  const error = $("[data-studio-error]", root);
  const saveButton = $("[data-save]", root);
  saveButton.addEventListener("click", async () => {
    if (!name.value.trim()) {
      error.textContent = "Give your bot a name first.";
      return show(error, true);
    }
    const label = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    show(error, false);
    const payload = {
      name: name.value,
      tagline: tagline.value,
      bio: field("bot-bio").value,
      persona: persona.value,
      greeting: greeting.value,
      starters: $$("[data-starter-input]", root).map((input) => input.value.trim()).filter(Boolean),
      avatarUrl: state.avatarUrl.trim(),
      avatarSeed: state.avatarSeed || handleify(name.value),
      accent: state.accent,
      tags: state.tags,
      warmth: dialValue("warmth"),
      chaos: dialValue("chaos"),
      wit: dialValue("wit"),
      temperature: dialValue("temperature"),
      visibility: state.visibility,
      model: config.model || "local",
    };
    const editing = config.mode === "edit";
    try {
      const { ok, data } = await api(editing ? "PATCH" : "POST", "/api/bots", editing ? { id: config.id, ...payload } : payload);
      if (!ok || !data.bot) throw new Error(data.error || "Could not save the bot.");
      saveButton.textContent = "Saved";
      window.location.href = `/bots/${data.bot.handle}`;
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : "Could not save the bot.";
      show(error, true);
      saveButton.disabled = false;
      saveButton.textContent = label;
    }
  });

  const deleteButton = $("[data-delete-bot]", root);
  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`Delete ${config.name} and every chat with them? This can't be undone.`)) return;
      deleteButton.disabled = true;
      const { ok } = await api("DELETE", `/api/bots/${config.id}`).catch(() => ({ ok: false }));
      if (ok) window.location.href = "/";
      else {
        error.textContent = "Could not delete that bot.";
        show(error, true);
        deleteButton.disabled = false;
      }
    });
  }

  render();
}

// ---------------------------------------------------------------- autopilot

function initAutopilot() {
  if (!$("[data-autopilot]")) return;
  const toast = $("[data-autopilot-toast]");
  const errorBox = $("[data-autopilot-error]");
  let live = storageGet("vesper:autopilot-live") === "on";
  let lastTick = null;
  let ticking = false;
  let toastTimer = null;

  function showToast(message) {
    toast.textContent = message;
    show(toast, true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show(toast, false), 3600);
  }

  function showError(message) {
    errorBox.textContent = message || "";
    show(errorBox, Boolean(message));
  }

  // Bits of the dashboard that live in the browser, re-applied after every refresh.
  function applyClientState() {
    const root = $("[data-autopilot]");
    const toggle = $("[data-live-toggle]", root);
    $("[data-label]", toggle).textContent = live ? "Pause heartbeat" : "Go live";
    toggle.className = `inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
      live ? "bg-white text-ink hover:bg-white/90" : "bg-lime text-ink hover:bg-lime-soft"
    }`;
    const badge = $("[data-live-badge]", root);
    badge.className = `flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${
      live ? "border-lime/40 bg-lime/10 text-lime" : "border-line text-muted"
    }`;
    $("[data-live-dot]", root).className = `h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-lime" : "bg-muted"}`;
    $("[data-live-text]", root).textContent = live ? "live" : "paused";
    $("[data-last-tick]", root).textContent = lastTick ? `last cycle ${lastTick}` : "no cycle run in this session";
  }

  /** Re-render the dashboard from the server's HTML. */
  async function refresh() {
    try {
      const response = await fetch("/autopilot", { cache: "no-store" });
      const html = await response.text();
      const fresh = new DOMParser().parseFromString(html, "text/html").querySelector("[data-autopilot]");
      if (fresh) $("[data-autopilot]").replaceWith(document.adoptNode(fresh));
    } catch {
      // Keep the current view if the refresh fails.
    }
    applyClientState();
  }

  async function run(body, { silent = false } = {}) {
    const { ok, data } = await api("POST", "/api/automation/run", body);
    if (!ok) throw new Error(data.error || "Run failed");
    lastTick = new Date().toLocaleTimeString();
    const outcomes = data.outcomes || [];
    if (!silent) {
      if (body.mode === "bot") {
        showToast(outcomes[0] ? `${outcomes[0].botName}: ${outcomes[0].summary}` : "Cycle complete.");
      } else {
        const executed = outcomes.filter((outcome) => outcome.status !== "skipped");
        showToast(
          executed.length
            ? executed.map((outcome) => `${outcome.botName}: ${outcome.summary}`).join(" · ")
            : "Nothing was due. Cadence and quiet hours are doing their job.",
        );
      }
    }
    await refresh();
  }

  async function tick(silent) {
    if (ticking) return;
    ticking = true;
    try {
      await run({ mode: "tick" }, { silent });
    } catch {
      if (!silent) showError("Couldn't run an autonomy cycle just now.");
    } finally {
      ticking = false;
    }
  }

  setInterval(() => live && tick(true), 30_000);

  async function update(botId, patch) {
    showError(null);
    const { ok, data } = await api("PUT", "/api/automation", { botId, ...patch }).catch(() => ({ ok: false, data: {} }));
    if (!ok) showError(data.error || "Could not save");
    await refresh();
  }

  document.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-autopilot]")) return;
    const target = event.target;
    if (target.closest("[data-live-toggle]")) {
      live = !live;
      storageSet("vesper:autopilot-live", live ? "on" : "off");
      return applyClientState();
    }
    const tickButton = target.closest("[data-tick]");
    if (tickButton) {
      tickButton.disabled = true;
      await tick(false);
      return;
    }
    const setter = target.closest("[data-set]");
    if (setter) {
      setter.disabled = true;
      const card = setter.closest("[data-automation]");
      return update(Number(card.dataset.automation), JSON.parse(setter.dataset.set));
    }
    const act = target.closest("[data-act-now]");
    if (act) {
      act.disabled = true;
      $("[data-label]", act).textContent = "acting…";
      showError(null);
      try {
        await run({ mode: "bot", botId: Number(act.dataset.actNow), force: true });
      } catch (err) {
        showError(err instanceof Error ? err.message : "Run failed");
        await refresh();
      }
      return;
    }
    const decide = target.closest("[data-decide]");
    if (decide) {
      decide.disabled = true;
      const decision = decide.dataset.decision;
      const { ok, data } = await api("PATCH", "/api/automation/runs", { id: Number(decide.dataset.decide), decision });
      if (ok) showToast(decision === "approve" ? "Delivered into the chat thread." : "Draft dismissed.");
      else showError(data.error || "Could not update");
      return refresh();
    }
    const task = target.closest("[data-task]");
    if (task) {
      task.disabled = true;
      const { ok } = await api("PATCH", "/api/tasks", { id: Number(task.dataset.task), done: task.dataset.done === "true" });
      if (!ok) showError("Couldn't update that task.");
      return refresh();
    }
    if (target.closest("[data-add-task]")) return addTask();
  });

  async function addTask() {
    const input = $("[data-new-task]");
    if (!input || !input.value.trim()) return;
    const { ok } = await api("POST", "/api/tasks", { botId: Number(input.dataset.newTask), title: input.value.trim() });
    if (!ok) showError("Couldn't add that task.");
    await refresh();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.closest("[data-new-task]")) addTask();
  });

  document.addEventListener("change", (event) => {
    const select = event.target.closest("[data-set-number]");
    if (!select) return;
    const card = select.closest("[data-automation]");
    update(Number(card.dataset.automation), { [select.dataset.setNumber]: Number(select.value) });
  });

  applyClientState();
}

document.addEventListener("DOMContentLoaded", () => {
  initShell();
  initRoster();
  initChat();
  initRuntime();
  initStudio();
  initAutopilot();
});
