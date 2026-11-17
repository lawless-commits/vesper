// Drives Vesper in headless Chromium and prints PASS/FAIL per check.
// Expects the app on VESPER_URL (default http://127.0.0.1:3000) with
// AUTOPILOT_TOKEN set, and the mock model server from mock-llm.mjs running.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const B = (process.env.VESPER_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const shots = new URL("./shots/", import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`);
};
const api = (path, method, body) =>
  fetch(B + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const lastText = (page) => page.locator("[data-chat-messages] [data-message-text]").last();
const messageCount = (page) => page.locator("[data-chat-messages] [data-message-id]").count();

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Africa/Johannesburg" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  // The invalid-timezone check below expects one 400 from the API.
  if (m.type() === "error" && !m.text().includes("status of 400")) errors.push(`console: ${m.text().slice(0, 200)}`);
});

try {
  // ---------- Discover ----------
  await page.goto(`${B}/`, { waitUntil: "networkidle" });
  const allCards = await page.locator("[data-roster] [data-bot-card]:visible").count();
  await page.locator('[data-tag-filter="goth"]').click();
  const gothCards = await page.locator("[data-roster] [data-bot-card]:visible").count();
  check("roster tag filter narrows the list", gothCards > 0 && gothCards < allCards, `${allCards} → ${gothCards}`);
  await page.locator('[data-tag-filter="all"]').click();
  await page.fill("[data-roster-search]", "zzzz-nobody");
  check("search with no match shows the empty state", await page.locator("[data-roster-empty]").isVisible());

  // ---------- Runtime form ----------
  await api("/api/runtime", "PUT", { provider: "demo", clearApiKey: true, timezone: "UTC", timeoutSeconds: 90, maxTokens: 600 });
  await page.goto(`${B}/runtime`, { waitUntil: "networkidle" });
  await page.locator('[data-provider="openai"]').click();
  await page.fill("#base-url", "http://127.0.0.1:11999/v1");
  await page.fill("#model", "mock");
  check("key box starts empty with 'No key saved.'", (await page.inputValue("#api-key")) === "" && (await page.getByText("No key saved.").isVisible()));
  await page.fill("#api-key", "sk-test-123");
  const suggest = page.getByRole("button", { name: /Use this browser's: Africa\/Johannesburg/ });
  check("timezone suggestion shows the browser's zone", await suggest.isVisible());
  await suggest.click();
  check("clicking it fills the timezone field", (await page.inputValue("#timezone")) === "Africa/Johannesburg");
  await page.fill("#timeout-seconds", "20");
  await page.fill("#max-tokens", "222");
  await page.getByRole("button", { name: /Save runtime/ }).click();
  await page.getByText(/Saved at/).waitFor();
  check(
    "after save the key box is cleared and says a key is saved",
    (await page.inputValue("#api-key")) === "" && (await page.getByText(/A key is saved on this machine/).isVisible()),
  );
  await page.getByRole("button", { name: /Test connection/ }).click();
  await page.getByText(/Connected\. 2 models available/).waitFor({ timeout: 10_000 });
  check("Test connection works with the saved key (none typed)", true);
  await page.reload({ waitUntil: "networkidle" });
  check(
    "after reload: key not in the page, settings kept",
    !(await page.content()).includes("sk-test-123") &&
      (await page.inputValue("#timezone")) === "Africa/Johannesburg" &&
      (await page.inputValue("#timeout-seconds")) === "20" &&
      (await page.inputValue("#max-tokens")) === "222",
  );
  await page.getByRole("button", { name: /Save runtime/ }).click();
  await page.getByText(/Saved at/).waitFor();
  check("saving with a blank key box keeps the key", (await api("/api/runtime", "GET")).runtime?.hasApiKey === true);
  await page.fill("#timezone", "Mars/Phobos");
  await page.getByRole("button", { name: /Save runtime/ }).click();
  await page.getByText(/Unknown timezone/).waitFor();
  check("an invalid timezone shows an error", true);
  await page.fill("#timezone", "Africa/Johannesburg");
  await page.screenshot({ path: `${shots}runtime.png`, fullPage: true });

  // ---------- Chat streaming ----------
  await api("/api/runtime", "PUT", {
    provider: "openai",
    baseUrl: "http://127.0.0.1:11999/v1",
    model: "long",
    timezone: "Africa/Johannesburg",
    timeoutSeconds: 20,
    maxTokens: 222,
  });
  const conv = (await api("/api/conversations", "POST", { botId: 1 })).conversation;
  await page.goto(`${B}/chats/${conv.id}`, { waitUntil: "networkidle" });
  const box = page.locator("[data-chat-input]");
  await box.fill("stream test one");
  await box.press("Enter");
  await page.getByRole("button", { name: "Stop the reply" }).waitFor();
  check("Send turns into Stop while replying", true);
  await page.waitForFunction(() => [...document.querySelectorAll("[data-chat-messages] [data-message-text]")].at(-1)?.textContent?.includes("word3"), null, { timeout: 8000 });
  const len1 = (await lastText(page).textContent()).length;
  await page.waitForTimeout(700);
  const len2 = (await lastText(page).textContent()).length;
  check("the reply grows token by token", len2 > len1, `${len1} → ${len2} chars`);
  check("the input is cleared after sending", (await box.inputValue()) === "");
  await page.screenshot({ path: `${shots}chat-streaming.png` });
  await page.getByRole("button", { name: "Send message" }).waitFor({ timeout: 20_000 });
  const full = await lastText(page).textContent();
  check("the full reply arrives and Send returns", full.includes("word79") && full.includes("limit=222"), "token limit 222 reached the model");
  check("the engine label shows the model", await page.getByText("local api · long").last().isVisible());

  // ---------- Stop ----------
  await box.fill("stream test two");
  await box.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-chat-messages] [data-message-text]")].at(-1)?.textContent?.includes("word8"), null, { timeout: 8000 });
  await page.getByRole("button", { name: "Stop the reply" }).click();
  await page.getByRole("button", { name: "Send message" }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(800);
  const partial = await lastText(page).textContent();
  check("Stop ends the reply and keeps the partial text", partial.includes("word8") && !partial.includes("word79"), `${partial.split(" ").length} words kept`);
  check("no error and the input is not refilled after Stop", (await box.inputValue()) === "" && !(await page.locator("[data-chat-error]").isVisible()));
  const afterStop = (await api(`/api/conversations/${conv.id}`, "GET")).messages;
  const copies = afterStop.filter((m) => m.content === "stream test two").length;
  const tail = afterStop.at(-1);
  check("the server saved the partial reply and one copy of the message", copies === 1 && tail.role === "assistant" && tail.content.includes("word8") && !tail.content.includes("word79"));
  await page.reload({ waitUntil: "networkidle" });
  check("a reload shows the same transcript", (await messageCount(page)) === afterStop.length, `${afterStop.length} messages`);
  await page.screenshot({ path: `${shots}chat-after-stop.png` });

  // ---------- Fallback notice ----------
  await api("/api/runtime", "PUT", { provider: "openai", baseUrl: "http://127.0.0.1:11998/v1", model: "mock", timezone: "Africa/Johannesburg" });
  await box.fill("is anyone there");
  await box.press("Enter");
  await page.getByText(/Couldn't reach your model/).waitFor({ timeout: 10_000 });
  check("an unreachable model gives a built-in reply plus a notice", await page.getByText("built-in engine").last().isVisible());

  // ---------- Built-in engine, voice flag, starters ----------
  await api("/api/runtime", "PUT", { provider: "demo", timezone: "Africa/Johannesburg" });
  await page.getByRole("button", { name: "Read replies aloud" }).click();
  await page.reload({ waitUntil: "networkidle" });
  check("the voice toggle survives a reload", await page.getByRole("button", { name: "Turn bot voice off" }).isVisible());
  await page.getByRole("button", { name: "Turn bot voice off" }).click();
  const before = await messageCount(page);
  await box.fill("hello built in");
  await box.press("Enter");
  await page.getByRole("button", { name: "Send message" }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  check("the built-in engine answers", (await messageCount(page)) === before + 2);
  const fresh = (await api("/api/conversations", "POST", { botId: 2 })).conversation;
  await page.goto(`${B}/chats/${fresh.id}`, { waitUntil: "networkidle" });
  await page.locator("[data-starter]").first().click();
  await page.getByRole("button", { name: "Send message" }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  check("an icebreaker button sends that message", (await messageCount(page)) === 3);

  // ---------- Start chatting from a profile with a prompt ----------
  await page.goto(`${B}/bots/luna`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Send this" }).first().click();
  await page.waitForURL(/\/chats\/\d+$/, { timeout: 10_000 });
  await page.getByRole("button", { name: "Send message" }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  check("'Send this' opens a chat and sends the icebreaker", (await messageCount(page)) === 3);

  // ---------- Studio ----------
  await page.goto(`${B}/studio`, { waitUntil: "networkidle" });
  await page.fill("#bot-name", "Test Pilot");
  await page.fill("#bot-tagline", "Flies the e2e check");
  check("the preview and handle follow the name", (await page.locator("[data-preview-name]").textContent()) === "Test Pilot" && (await page.locator("[data-studio-handle]").textContent()) === "@test-pilot");
  await page.locator('[data-preset="orbit"]').click();
  check("picking a preset marks it and updates the preview", (await page.locator('[data-preset="orbit"]').getAttribute("aria-pressed")) === "true" && (await page.locator("[data-preview-avatar]").getAttribute("src")).includes("preset=orbit"));
  await page.locator('[data-vibe="noir"]').click();
  await page.fill("#custom-tag", "aviation");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  check("tags can be added", (await page.locator("[data-tag-list] > span").count()) === 2);
  await page.getByRole("button", { name: /Draft from dials/ }).click();
  await page.waitForFunction(() => document.getElementById("bot-persona").value.startsWith("Test Pilot is a noir companion"));
  check("'Draft from dials' writes a persona and icebreakers", (await page.locator("[data-starter-input]").first().inputValue()).length > 0);
  await page.screenshot({ path: `${shots}studio.png`, fullPage: true });
  await page.getByRole("button", { name: "Create bot" }).click();
  await page.waitForURL(/\/bots\/test-pilot$/, { timeout: 10_000 });
  check("creating a bot lands on its profile", await page.getByRole("heading", { name: "Test Pilot", exact: true }).isVisible());
  await page.goto(`${B}/studio/${(await api("/api/bots", "GET")).bots.find((b) => b.handle === "test-pilot").id}`, { waitUntil: "networkidle" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Delete bot/ }).click();
  await page.waitForURL(`${B}/`, { timeout: 10_000 });
  check("deleting a bot from the studio works", !(await api("/api/bots", "GET")).bots.some((b) => b.handle === "test-pilot"));

  // ---------- Autopilot ----------
  await page.goto(`${B}/autopilot`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Go live" }).click();
  await page.getByRole("button", { name: "Pause heartbeat" }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  check("live mode survives a reload", await page.getByRole("button", { name: "Pause heartbeat" }).isVisible());
  const tick = page.waitForResponse((r) => r.url().endsWith("/api/automation/run"));
  await page.getByRole("button", { name: /Run a cycle/ }).click();
  check("'Run a cycle' from the UI is accepted with AUTOPILOT_TOKEN set", (await tick).status() === 200);
  check("the same call from outside the browser is refused", (await fetch(`${B}/api/automation/run`, { method: "POST" })).status === 401);
  const act = page.waitForResponse((r) => r.url().endsWith("/api/automation/run"));
  await page.getByRole("button", { name: /act now/ }).first().click();
  check("'act now' works and the feed shows a source label", (await act).status() === 200 && (await page.getByText(/source: (template|model|mixed)/).first().isVisible()));
  const firstCard = page.locator("[data-automation]").first();
  const armedBefore = await firstCard.getByRole("button", { name: /arm autopilot/i }).getAttribute("aria-label");
  const refreshed = page.waitForResponse((r) => r.url().endsWith("/autopilot"));
  await firstCard.getByRole("button", { name: /arm autopilot/i }).click();
  await refreshed;
  await page.waitForTimeout(300);
  const armedAfter = await page.locator("[data-automation]").first().getByRole("button", { name: /arm autopilot/i }).getAttribute("aria-label");
  check("the arm switch toggles and the dashboard refreshes", armedBefore !== armedAfter, `${armedBefore} → ${armedAfter}`);
  check("the rails name the configured timezone", (await page.content()).includes("(Africa/Johannesburg)"));
  await page.getByRole("button", { name: "Pause heartbeat" }).click();
  await page.screenshot({ path: `${shots}autopilot.png`, fullPage: true });

  // ---------- Mobile menu ----------
  const mobile = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const m = await mobile.newPage();
  m.on("pageerror", (e) => errors.push(`mobile pageerror: ${e.message}`));
  await m.goto(`${B}/`, { waitUntil: "networkidle" });
  await m.getByRole("button", { name: "Open menu" }).click();
  await m.getByRole("button", { name: "Close menu overlay" }).waitFor();
  await m.screenshot({ path: `${shots}mobile-menu.png` });
  await m.locator("#mobile-menu a", { hasText: "Your chats" }).click();
  await m.waitForURL("**/chats");
  check("the mobile menu opens, and is closed after navigating", !(await m.locator("#mobile-menu").isVisible()));
  await m.getByRole("button", { name: "Open menu" }).click();
  await m.getByRole("button", { name: "Close menu", exact: true }).click();
  check("the mobile menu close button works", !(await m.locator("#mobile-menu").isVisible()));
  await m.goto(`${B}/`, { waitUntil: "networkidle" });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no sideways scrolling on a phone", overflow <= 0, `${overflow}px`);
  await m.screenshot({ path: `${shots}mobile-discover.png`, fullPage: true });

  // ---------- Every page renders without script errors ----------
  for (const path of ["/", "/chats", "/studio", "/studio/1", "/capabilities", "/bots/ani"]) {
    await page.goto(`${B}${path}`, { waitUntil: "networkidle" });
  }
  const missing = await fetch(`${B}/no-such-page`);
  check("unknown pages return the 404 page", missing.status === 404 && (await missing.text()).includes("signal lost"));
  await page.goto(`${B}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shots}discover.png`, fullPage: true });
  await page.goto(`${B}/capabilities`, { waitUntil: "networkidle" });
  check("Capabilities lists streaming as live", (await page.locator("article", { hasText: "Token streaming" }).textContent()).includes("live"));
  check("no JavaScript errors on any page", errors.length === 0, errors.slice(0, 4).join(" | "));
} catch (error) {
  check("the run finished without an unexpected error", false, String(error).slice(0, 400));
  await page.screenshot({ path: `${shots}failure.png`, fullPage: true }).catch(() => {});
} finally {
  await api("/api/runtime", "PUT", { provider: "demo", clearApiKey: true, timezone: "UTC", timeoutSeconds: 90, maxTokens: 600 }).catch(() => {});
  await browser.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
