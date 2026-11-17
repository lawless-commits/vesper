//! HTML pages. Each handler loads its data, then renders with maud.
//! Interactive parts are wired up by static/app.js through data-* attributes.

use std::collections::BTreeSet;

use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, Uri};
use axum::response::{Html, IntoResponse, Response};
use maud::{Markup, html};
use serde_json::json;

use crate::autopilot;
use crate::avatar::{ACCENTS, GLYPH_PRESETS, avatar_src, glyph_url};
use crate::capabilities::{API_SURFACE, CAPABILITIES, EXTENSIONS, LIMITS};
use crate::data;
use crate::http::AppState;
use crate::icons::icon;
use crate::models::{ACTION_META, AutopilotSnapshot, Bot, RunView, action_meta};
use crate::persona::runtime_badge;
use crate::util::{VIBE_TAGS, accent_alpha, handleify, time_ago, trait_label, truncate};
use crate::validate::parse_id_str;
use crate::views::{
    AvatarOpts, ButtonStyle, FIELD, LABEL, Shell, avatar, avatar_from, bot_card, code_block, create_bot_card, eyebrow,
    json_script, layout, start_chat_button,
};

type PageResult = Result<Response, PageError>;

/// A page that failed to load (a database error). Boxed to keep results small.
pub struct PageError(Box<Response>);

impl IntoResponse for PageError {
    fn into_response(self) -> Response {
        *self.0
    }
}

fn server_error(error: sqlx::Error) -> PageError {
    tracing::error!(%error, "page failed");
    PageError(Box::new(
        (StatusCode::INTERNAL_SERVER_ERROR, Html("<h1>Something went wrong</h1><p>Check the server log.</p>")).into_response(),
    ))
}

async fn shell(state: &AppState, path: &str) -> Result<Shell, PageError> {
    let bots = data::list_bots(&state.pool).await.map_err(server_error)?;
    let runtime = data::get_runtime_config(&state.pool).await.map_err(server_error)?.view();
    Ok(Shell { path: path.to_string(), bots, runtime })
}

fn page(title: &str, shell: &Shell, content: Markup) -> Response {
    Html(layout(title, shell, content).into_string()).into_response()
}

async fn not_found_page(state: &AppState, path: &str) -> Response {
    let content = html! {
        div class="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center" {
            span class="font-mono text-xs tracking-[0.3em] text-lime uppercase" { "404 · signal lost" }
            h1 class="mt-4 text-3xl font-semibold tracking-tight text-white" { "This bot isn't on the roster" }
            p class="mt-2 text-sm text-muted" { "The companion or chat you were looking for may have been deleted, or the handle is wrong." }
            div class="mt-6 flex gap-2" {
                a href="/" class="rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft" { "Back to discover" }
                a href="/studio" class="rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm text-white transition hover:border-white/25" { "Build a new bot" }
            }
        }
    };
    match shell(state, path).await {
        Ok(shell) => (StatusCode::NOT_FOUND, Html(layout("Not found", &shell, content).into_string())).into_response(),
        Err(error) => error.into_response(),
    }
}

pub async fn not_found(State(state): State<AppState>, uri: Uri) -> Response {
    not_found_page(&state, uri.path()).await
}

fn stat_tile(label: &str, value: &str, glyph: &str, hint: Option<&str>, tone: &str) -> Markup {
    html! {
        div class="rounded-2xl border border-line/70 bg-panel/40 px-4 py-3" {
            div class="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase" {
                (icon(glyph, 11, "")) " " (label)
            }
            p class={ "mt-1 truncate text-lg font-semibold " (tone) } { (value) }
            @if let Some(hint) = hint { p class="text-[11px] text-muted/80" { (hint) } }
        }
    }
}

// ----- Discover -----

pub async fn discover(State(state): State<AppState>) -> PageResult {
    let shell = shell(&state, "/").await?;
    let chats = data::list_conversations(&state.pool, None).await.map_err(server_error)?;
    let bots = &shell.bots;
    let runtime = &shell.runtime;
    let featured: Vec<&Bot> = bots.iter().filter(|b| b.featured).take(3).collect();
    let hero: Vec<&Bot> = if featured.is_empty() { bots.iter().take(3).collect() } else { featured.clone() };
    let tags: BTreeSet<&String> = bots.iter().flat_map(|b| b.tags.iter()).collect();

    let content = html! {
        div class="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10" {
            div class="mb-6 flex flex-wrap items-center justify-between gap-3" {
                div {
                    p class="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase" { "Discover" }
                    h1 class="mt-1 text-2xl font-semibold tracking-tight text-white" { "The roster" }
                }
                div class="flex items-center gap-2" {
                    span class="hidden items-center gap-2 rounded-full border border-line bg-panel/70 px-3 py-1.5 text-[11px] text-muted sm:inline-flex" {
                        span class="h-1.5 w-1.5 rounded-full bg-lime" {} (runtime_badge(&runtime.provider))
                    }
                    a href="/studio" class="inline-flex items-center gap-2 rounded-xl bg-lime px-4 py-2 text-sm font-semibold text-ink transition hover:bg-lime-soft" {
                        (icon("wand", 15, "")) "Create a bot"
                    }
                }
            }

            section class="relative overflow-hidden rounded-[28px] border border-line/80 bg-gradient-to-br from-panel-2/90 via-panel/60 to-ink p-6 sm:p-9" {
                div class="pointer-events-none absolute -top-32 -left-24 h-72 w-72 rounded-full bg-lime/10 blur-3xl" {}
                div class="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-violet/10 blur-3xl" {}
                div class="relative grid items-center gap-9 lg:grid-cols-[1.05fr_0.95fr]" {
                    div {
                        span class="inline-flex items-center gap-2 rounded-full border border-lime/25 bg-lime/[0.08] px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-lime uppercase" {
                            (icon("spark", 11, "")) " Local-first companion studio"
                        }
                        h2 class="mt-4 text-[34px] leading-[1.05] font-semibold tracking-tight text-white sm:text-[46px]" {
                            "Your own bots." br; span class="text-lime" { "Your own machine." }
                        }
                        p class="mt-4 max-w-lg text-sm leading-relaxed text-white/60 sm:text-[15px]" {
                            "Design a character with an avatar, a personality and a voice — then chat with them the way you would with any big-name AI. Everything is stored on this device, and every reply can run on your own local model."
                        }
                        div class="mt-6 flex flex-wrap items-center gap-2.5" {
                            a href="/studio" class="inline-flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft" {
                                (icon("wand", 16, "")) " Design a companion"
                            }
                            @if let Some(first) = bots.first() {
                                a href={ "/bots/" (first.handle) } class="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.06]" {
                                    (icon("chat", 16, "")) " Meet " (first.name)
                                }
                            }
                        }
                        p class="mt-4 flex items-center gap-1.5 text-[11px] text-muted" {
                            (icon("shield", 13, "text-lime/80")) "No accounts. No cloud calls. Nothing to subscribe to."
                        }
                    }
                    div class="relative mx-auto grid w-full max-w-sm grid-cols-2 gap-3" {
                        @if let Some(top) = hero.first() {
                            div class="animate-float col-span-2 flex items-center gap-3 rounded-2xl border border-line/90 bg-ink/70 p-3 backdrop-blur-sm" {
                                (avatar(top, 62, AvatarOpts { online: true, ..Default::default() }))
                                div class="min-w-0" {
                                    p class="truncate text-sm font-semibold text-white" { (top.name) }
                                    p class="line-clamp-2 text-[11px] leading-snug text-muted" { (top.tagline) }
                                }
                            }
                        }
                        @for bot in hero.iter().skip(1).take(2) {
                            div class="rounded-2xl border border-line/90 bg-ink/70 p-3" {
                                (avatar(bot, 44, AvatarOpts::default()))
                                p class="mt-2 truncate text-xs font-semibold text-white" { (bot.name) }
                                p class="truncate font-mono text-[10px] text-muted" { "@" (bot.handle) }
                            }
                        }
                        div class="col-span-2 flex items-center justify-between rounded-2xl border border-line/90 bg-ink/70 px-3 py-2.5" {
                            div class="flex -space-x-2" {
                                @for bot in bots.iter().take(5) { (avatar(bot, 26, AvatarOpts { glow: false, ..Default::default() })) }
                            }
                            span class="text-[11px] text-muted" { (bots.len()) " companions ready" }
                        }
                    }
                }
            }

            section class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" {
                (stat_tile("Companions", &bots.len().to_string(), "spark", Some("in your roster"), "text-white"))
                (stat_tile("Saved chats", &chats.len().to_string(), "chat", Some("stored locally"), "text-white"))
                (stat_tile("Engine", if runtime.provider == "demo" { "Vesper local" } else { &runtime.model }, "bolt",
                    Some(if runtime.provider == "demo" { "no setup needed" } else { "your model server" }), "text-white"))
                (stat_tile("Privacy", "Local-first", "shield", Some("prompts go only to your model"), "text-white"))
            }

            @if !featured.is_empty() {
                section class="mt-10" {
                    div class="mb-4 flex items-end justify-between" {
                        div {
                            h2 class="text-lg font-semibold tracking-tight text-white" { "Featured companions" }
                            p class="text-xs text-muted" { "Hand-built personalities. Each one is fully editable." }
                        }
                        a href="/studio" class="flex items-center gap-1 text-xs text-muted transition hover:text-white" {
                            "Make one like this " (icon("arrow-right", 13, ""))
                        }
                    }
                    div class="grid gap-4 md:grid-cols-3" { @for bot in &featured { (bot_card(bot)) } }
                }
            }

            section class="mt-10" {
                div class="mb-4" {
                    h2 class="text-lg font-semibold tracking-tight text-white" { "Everyone in the roster" }
                    p class="text-xs text-muted" { "Filter by vibe, or search for a name and start talking." }
                }
                div data-roster {
                    div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" {
                        div class="flex flex-wrap items-center gap-1.5" {
                            button type="button" data-tag-filter="all" aria-pressed="true" class="tag-chip rounded-full border px-3 py-1.5 text-xs transition" { "All bots" }
                            @for tag in &tags {
                                button type="button" data-tag-filter=(tag) aria-pressed="false" class="tag-chip rounded-full border px-3 py-1.5 text-xs transition" { (tag) }
                            }
                        }
                        label class="relative flex items-center sm:w-64" {
                            (icon("search", 16, "pointer-events-none absolute left-3 text-muted"))
                            input data-roster-search placeholder="Search the roster" aria-label="Search the roster"
                                class="w-full rounded-xl border border-line bg-panel/70 py-2 pr-3 pl-9 text-sm text-white placeholder:text-muted/60 focus:border-lime/50 focus:ring-2 focus:ring-lime/15 focus:outline-none";
                        }
                    }
                    div class="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" {
                        @for bot in bots { (bot_card(bot)) }
                        (create_bot_card())
                    }
                    div data-roster-empty class="mt-10 hidden rounded-2xl border border-line/70 bg-panel/40 p-8 text-center" {
                        p class="text-sm font-medium text-white" { "Nothing matches “" span data-roster-query {} "” yet." }
                        p class="mt-1 text-xs text-muted" { "Try a broader search, or build exactly the bot you're looking for." }
                    }
                }
            }

            footer class="mt-12 flex flex-col gap-2 border-t border-line/70 pt-5 text-[11px] text-muted/70 sm:flex-row sm:items-center sm:justify-between" {
                p { "Vesper runs on your machine. Bots and transcripts live in your local Postgres." }
                span class="flex items-center gap-3" {
                    a href="/capabilities" class="flex items-center gap-1 text-muted transition hover:text-lime" { "What bots can do " (icon("arrow-right", 12, "")) }
                    a href="/runtime" class="flex items-center gap-1 text-muted transition hover:text-lime" { "Connect Ollama or LM Studio " (icon("arrow-right", 12, "")) }
                }
            }
        }
    };
    Ok(page("", &shell, content))
}

// ----- Chats -----

pub async fn chats(State(state): State<AppState>) -> PageResult {
    let shell = shell(&state, "/chats").await?;
    let chats = data::list_conversations(&state.pool, None).await.map_err(server_error)?;
    let total: i64 = chats.iter().map(|c| c.message_count).sum();
    let suggestions: Vec<&Bot> = shell.bots.iter().filter(|b| !chats.iter().any(|c| c.bot_id == b.id)).take(2).collect();
    let first = shell.bots.first();

    let content = html! {
        div class="mx-auto max-w-5xl px-5 py-8 lg:px-10 lg:py-10" {
            div class="flex flex-wrap items-end justify-between gap-4" {
                div {
                    p class="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase" { "Transcripts" }
                    h1 class="mt-1 text-2xl font-semibold tracking-tight text-white" { "Your chats" }
                    p class="mt-1 text-sm text-muted" {
                        (chats.len()) " thread" @if chats.len() != 1 { "s" } " · " (total) " messages, all stored locally."
                    }
                }
                @if let Some(bot) = first {
                    div class="flex items-center gap-2" {
                        a href="/" class="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-xs text-muted transition hover:text-white" { "Browse roster" }
                        (start_chat_button(bot.id, &format!("Chat with {}", bot.name), None, ButtonStyle::Primary, "px-4 py-2 text-xs"))
                    }
                }
            }
            @if !chats.is_empty() {
                div class="mt-6 space-y-2.5" {
                    @for chat in &chats {
                        div data-conversation-row class="lift flex items-center gap-3 rounded-2xl border border-line/70 bg-panel/40 p-3 sm:gap-4 sm:p-3.5" {
                            a href={ "/bots/" (chat.bot.handle) } class="shrink-0" { (avatar(&chat.bot, 46, AvatarOpts { online: true, ..Default::default() })) }
                            a href={ "/chats/" (chat.id) } class="min-w-0 flex-1" {
                                div class="flex items-center gap-2" {
                                    p class="truncate text-sm font-semibold text-white" { (chat.title) }
                                    span class="hidden shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9px] text-muted sm:inline" { (chat.bot.name) }
                                }
                                p class="mt-0.5 truncate text-xs text-muted" {
                                    @match &chat.last_message { Some(m) => (truncate(m, 120)), None => "No messages yet" }
                                }
                                p class="mt-1 text-[10px] text-muted/60" {
                                    (time_ago(chat.updated_at)) " · " (chat.message_count) " message" @if chat.message_count != 1 { "s" }
                                }
                            }
                            button type="button" data-delete-conversation=(chat.id) title="Delete chat" aria-label="Delete chat"
                                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line/70 bg-white/[0.02] text-muted transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-50" {
                                (icon("trash", 14, ""))
                            }
                        }
                    }
                }
            } @else {
                div class="mt-6 rounded-3xl border border-dashed border-line bg-panel/30 p-8 text-center sm:p-12" {
                    span class="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line bg-white/[0.03] text-lime" { (icon("chat", 24, "")) }
                    h2 class="mt-4 text-lg font-semibold text-white" { "No conversations yet" }
                    p class="mx-auto mt-1 max-w-sm text-sm text-muted" { "Pick a companion and say something strange. Transcripts appear here automatically." }
                    @if let Some(bot) = first {
                        div class="mx-auto mt-4 w-56" { (start_chat_button(bot.id, &format!("Say hi to {}", bot.name), None, ButtonStyle::Primary, "px-4 py-2.5 text-sm")) }
                    }
                }
            }
            @if !suggestions.is_empty() {
                section class="mt-10" {
                    div class="mb-3 flex items-center gap-2" {
                        (icon("spark", 14, "text-lime"))
                        h2 class="text-sm font-semibold text-white" { "You haven't met these yet" }
                    }
                    div class="grid gap-4 sm:grid-cols-2" { @for bot in &suggestions { (bot_card(bot)) } }
                }
            }
        }
    };
    Ok(page("Your chats", &shell, content))
}

// ----- Chat -----

#[derive(serde::Deserialize)]
pub struct ChatQuery {
    say: Option<String>,
}

fn engine_label(engine: &str) -> String {
    match engine {
        "" | "user" => String::new(),
        "vesper-local" => "built-in engine".into(),
        e if e.starts_with("ollama:") => format!("ollama · {}", &e[7..]),
        e if e.starts_with("openai:") => format!("local api · {}", &e[7..]),
        e => e.to_string(),
    }
}

pub async fn chat(State(state): State<AppState>, Path(id): Path<String>, Query(query): Query<ChatQuery>) -> PageResult {
    let path = format!("/chats/{id}");
    let Some(id) = parse_id_str(&id) else { return Ok(not_found_page(&state, &path).await) };
    let Some((conversation, messages)) = data::get_conversation(&state.pool, id).await.map_err(server_error)? else {
        return Ok(not_found_page(&state, &path).await);
    };
    let shell = shell(&state, &path).await?;
    let threads = data::list_conversations(&state.pool, Some(conversation.bot_id)).await.map_err(server_error)?;
    let bot = &conversation.bot;
    let runtime = &shell.runtime;
    let user_name = if runtime.user_name.is_empty() { "You" } else { &runtime.user_name };
    let bot_avatar = avatar_src(bot.avatar_url.as_deref(), &bot.avatar_seed, &bot.name);
    let config = json!({
        "conversationId": conversation.id,
        "bot": { "name": bot.name, "handle": bot.handle, "tagline": bot.tagline, "chaos": bot.chaos, "warmth": bot.warmth, "avatar": bot_avatar },
        "userName": user_name,
        "starters": bot.starters,
        "initialPrompt": query.say,
        "messageCount": messages.len(),
    });

    let content = html! {
        div class="flex h-[calc(100dvh-65px)] min-h-0 lg:h-dvh" {
            aside class="hidden w-[264px] shrink-0 flex-col border-r border-line/70 bg-ink/40 lg:flex" {
                div class="border-b border-line/70 p-4" {
                    a href="/chats" class="inline-flex items-center gap-1.5 text-[11px] text-muted hover:text-white" { (icon("back", 12, "")) " All chats" }
                    a href={ "/bots/" (bot.handle) } class="mt-3 flex items-center gap-2.5" {
                        (avatar(bot, 38, AvatarOpts::default()))
                        div class="min-w-0" {
                            p class="truncate text-sm font-semibold text-white" { (bot.name) }
                            p class="truncate font-mono text-[10px] text-muted" { "@" (bot.handle) }
                        }
                    }
                    div class="mt-3" { (start_chat_button(bot.id, "New chat", None, ButtonStyle::Outline, "px-4 py-2 text-xs")) }
                }
                div class="min-h-0 flex-1 overflow-y-auto p-2" {
                    p class="px-2 py-2 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase" { "Threads · " (threads.len()) }
                    div class="space-y-1" {
                        @for thread in &threads {
                            @let active = thread.id == conversation.id;
                            a href={ "/chats/" (thread.id) } class={ "block rounded-xl px-2.5 py-2.5 transition " (if active { "border border-lime/25 bg-lime/[0.07]" } else { "border border-transparent hover:bg-white/[0.04]" }) } {
                                p class={ "truncate text-xs " (if active { "font-medium text-white" } else { "text-white/75" }) } { (thread.title) }
                                p class="mt-0.5 truncate text-[10px] text-muted" { (time_ago(thread.updated_at)) " · " (thread.message_count) " msg" }
                                @if let Some(last) = &thread.last_message {
                                    p class="mt-1 line-clamp-1 text-[10px] text-muted/70" { (truncate(last, 62)) }
                                }
                            }
                        }
                    }
                }
                div class="border-t border-line/70 p-3" {
                    a href="/studio" class="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[11px] text-muted transition hover:border-lime/30 hover:text-lime" {
                        (icon("plus", 12, "")) " Design a new bot"
                    }
                }
            }

            div class="min-w-0 flex-1" {
                div data-chat class="flex h-full min-h-0 flex-col" {
                    (json_script("chat-config", &config))
                    header class="flex items-center gap-3 border-b border-line/70 bg-ink/60 px-4 py-3 backdrop-blur-xl sm:px-5" {
                        a href="/chats" class="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-white lg:hidden" aria-label="Back to chats" { (icon("back", 16, "")) }
                        a href={ "/bots/" (bot.handle) } class="flex min-w-0 items-center gap-3" {
                            (avatar(bot, 42, AvatarOpts { online: true, ..Default::default() }))
                            div class="min-w-0" {
                                p class="truncate text-sm font-semibold text-white" { (bot.name) }
                                p class="truncate text-[11px] text-muted" { @if bot.tagline.is_empty() { "@" (bot.handle) } @else { (bot.tagline) } }
                            }
                        }
                        div class="ml-auto flex items-center gap-2" {
                            span class="hidden items-center gap-1.5 rounded-full border border-line bg-panel/60 px-2.5 py-1 text-[10px] text-muted sm:inline-flex" {
                                (icon("spark", 10, "text-lime")) (runtime_badge(&runtime.provider))
                            }
                            button type="button" data-voice-toggle aria-label="Read replies aloud" title="Read replies aloud"
                                class="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-white" {
                                span data-voice-off { (icon("volume-off", 15, "")) }
                                span data-voice-on class="hidden" { (icon("volume", 15, "")) }
                            }
                            a href={ "/studio/" (bot.id) } class="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:text-white" aria-label="Edit bot" { (icon("edit", 15, "")) }
                        }
                    }

                    div data-chat-scroll class="min-h-0 flex-1 overflow-y-auto" {
                        div data-chat-messages class="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6" {
                            @for message in &messages {
                                @if message.role == "user" {
                                    (user_bubble(&message.content, user_name, message.id))
                                } @else {
                                    (bot_bubble(bot, &bot_avatar, &message.content, &engine_label(&message.engine), message.id))
                                }
                            }
                        }
                        div class="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6" {
                            div data-chat-typing class="animate-fade hidden gap-2.5" {
                                (avatar_from(&bot_avatar, &bot.name, 34, AvatarOpts { glow: false, ..Default::default() }))
                                div class="flex items-center gap-2 rounded-2xl rounded-tl-md border border-line/80 bg-panel/70 px-4 py-3" {
                                    span class="typing-dot h-1.5 w-1.5 rounded-full bg-lime" {}
                                    span class="typing-dot h-1.5 w-1.5 rounded-full bg-lime" style="animation-delay:150ms" {}
                                    span class="typing-dot h-1.5 w-1.5 rounded-full bg-lime" style="animation-delay:300ms" {}
                                    span class="ml-1 text-[11px] text-muted" { (bot.name) " is typing" }
                                }
                            }
                            div data-chat-error class="hidden rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200" {}
                            @if messages.len() <= 1 && !bot.starters.is_empty() {
                                div data-chat-starters class="mt-2" {
                                    p class="mb-2 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase" { "Try opening with" }
                                    div class="flex flex-wrap gap-2" {
                                        @for starter in &bot.starters {
                                            button type="button" data-starter=(starter)
                                                class="rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-left text-xs text-white/75 transition hover:border-lime/40 hover:bg-lime/[0.06] hover:text-white" {
                                                (starter)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    div class="border-t border-line/70 bg-ink/70 px-3 pt-3 pb-4 backdrop-blur-xl sm:px-5" {
                        div class="mx-auto w-full max-w-3xl" {
                            div data-chat-notice class="mb-2 hidden items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] px-3 py-2 text-[11px] text-amber-100/90" {
                                span data-chat-notice-text class="flex-1" {}
                                button type="button" data-chat-notice-dismiss class="text-amber-200/70 hover:text-amber-100" aria-label="Dismiss notice" { "✕" }
                            }
                            div class="flex items-end gap-2 rounded-2xl border border-line bg-panel/80 p-2 transition focus-within:border-lime/40 focus-within:ring-2 focus-within:ring-lime/10" {
                                textarea data-chat-input rows="1" placeholder={ "Message " (bot.name) "…" } aria-label={ "Message " (bot.name) }
                                    class="max-h-[10.5rem] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white placeholder:text-muted/60 focus:outline-none" {}
                                button type="button" data-chat-send aria-label="Send message" disabled
                                    class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime text-ink transition hover:bg-lime-soft disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-muted" {
                                    (icon("send", 17, ""))
                                }
                                button type="button" data-chat-stop aria-label="Stop the reply" title="Stop — keeps what has arrived so far"
                                    class="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.06] text-white transition hover:border-red-300/50 hover:text-red-200" {
                                    (icon("stop", 17, ""))
                                }
                            }
                            p class="mt-2 flex items-center justify-between px-1 text-[10px] text-muted/70" {
                                span { "Enter to send · Shift + Enter for a new line" }
                                span class="hidden sm:inline" { "Private · stored on this machine" }
                            }
                        }
                    }
                }
            }
        }
    };
    Ok(page(&conversation.title, &shell, content))
}

pub fn user_bubble(content: &str, user_name: &str, id: i32) -> Markup {
    let initial: String = user_name.chars().next().map(|c| c.to_uppercase().collect()).unwrap_or_else(|| "Y".into());
    html! {
        div data-message-id=(id) data-role="user" class="animate-rise flex justify-end gap-2.5" {
            div class="flex max-w-[85%] flex-col items-end" {
                div data-message-text class="rounded-2xl rounded-br-md bg-lime px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-ink shadow-[0_10px_30px_-16px_rgba(201,249,84,0.8)]" { (content) }
                span class="mt-1 pr-1 text-[10px] text-muted" { (user_name) }
            }
            span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-line bg-panel-2 text-[11px] font-semibold text-white/80" { (initial) }
        }
    }
}

pub fn bot_bubble(bot: &Bot, avatar_url: &str, content: &str, engine: &str, id: i32) -> Markup {
    html! {
        div data-message-id=(id) data-role="assistant" class="animate-rise flex gap-2.5" {
            (avatar_from(avatar_url, &bot.name, 34, AvatarOpts { glow: false, ..Default::default() }))
            div class="group min-w-0 max-w-[86%]" {
                div class="mb-1 flex items-center gap-2" {
                    span class="text-xs font-semibold text-white/90" { (bot.name) }
                    span data-message-engine class="font-mono text-[10px] text-muted/80" { (engine) }
                }
                div data-message-text class="rounded-2xl rounded-tl-md border border-line/80 bg-panel/70 px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-white/85" { (content) }
                div class="mt-1 flex items-center gap-2 pl-1 opacity-0 transition group-hover:opacity-100" {
                    button type="button" data-message-copy class="flex items-center gap-1 text-[10px] text-muted transition hover:text-white" { (icon("copy", 11, "")) span { "copy" } }
                    button type="button" data-message-speak class="flex items-center gap-1 text-[10px] text-muted transition hover:text-white" { (icon("volume", 11, "")) " speak" }
                    span class="text-[10px] text-muted/60" { "@" (bot.handle) }
                }
            }
        }
    }
}

// ----- Bot profile -----

pub async fn bot_profile(State(state): State<AppState>, Path(handle): Path<String>) -> PageResult {
    let path = format!("/bots/{handle}");
    let Some(bot) = data::get_bot_by_handle(&state.pool, &handle).await.map_err(server_error)? else {
        return Ok(not_found_page(&state, &path).await);
    };
    let shell = shell(&state, &path).await?;
    let chats = data::list_conversations(&state.pool, Some(bot.id)).await.map_err(server_error)?;
    let runs = autopilot::list_runs(&state.pool, 30).await.map_err(server_error)?;
    let transmissions: Vec<&RunView> = runs.iter().filter(|r| r.bot_id == bot.id).take(3).collect();
    let accent = if bot.accent.is_empty() { "#c9f954".to_string() } else { bot.accent.clone() };
    let runtime = &shell.runtime;
    let traits = [
        ("Warmth", bot.warmth, "detached", "devoted", "#f9a8d4"),
        ("Chaos", bot.chaos, "steady", "unhinged", "#c9f954"),
        ("Wit", bot.wit, "plain-spoken", "razor-sharp", "#7dd3fc"),
    ];

    let content = html! {
        div class="mx-auto max-w-6xl px-5 py-6 lg:px-10 lg:py-8" {
            a href="/" class="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-white" { (icon("back", 13, "")) " Back to the roster" }
            div class="relative mt-4 overflow-hidden rounded-[28px] border border-line/80 bg-panel/50" {
                div class="h-28 w-full sm:h-32" style="background-image: linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), radial-gradient(90% 170% at 16% 0%, rgba(255,255,255,0.13) 0%, transparent 62%), linear-gradient(120deg, #191c20, #08090b); background-size: 34px 34px, 34px 34px, auto, auto" {}
                div class="relative -mt-12 px-5 pb-6 sm:px-7" {
                    div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between" {
                        div class="flex items-end gap-4" {
                            (avatar(&bot, 104, AvatarOpts { online: true, class: "animate-pop border-2 border-ink", ..Default::default() }))
                            div class="pb-1" {
                                div class="flex flex-wrap items-center gap-2" {
                                    h1 class="text-2xl font-semibold tracking-tight text-white" { (bot.name) }
                                    @if bot.featured {
                                        span class="inline-flex items-center gap-1 rounded-full border border-lime/25 bg-lime/10 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase" { (icon("spark", 9, "")) " featured" }
                                    }
                                }
                                p class="font-mono text-xs text-muted" { "@" (bot.handle) }
                                p class="mt-1 text-sm text-white/60" { (bot.tagline) }
                            }
                        }
                        div class="flex items-center gap-2 pb-1" {
                            a href={ "/studio/" (bot.id) } class="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white/[0.03] px-3 py-2 text-xs font-medium text-white transition hover:border-white/25" { (icon("edit", 14, "")) " Edit" }
                            div class="min-w-[150px]" { (start_chat_button(bot.id, "Start chatting", None, ButtonStyle::Primary, "px-4 py-2.5 text-sm")) }
                        }
                    }
                    div class="mt-4 flex flex-wrap gap-1.5" {
                        @for tag in &bot.tags {
                            span class="rounded-full border px-2.5 py-1 text-[11px]" style={ "border-color:" (accent_alpha(&accent, 0.3)) ";background:" (accent_alpha(&accent, 0.08)) ";color:" (accent_alpha(&accent, 0.95)) } { (tag) }
                        }
                        span class="rounded-full border border-line px-2.5 py-1 text-[11px] text-muted" { (bot.visibility) }
                    }
                }
            }

            div class="mt-5 grid gap-5 lg:grid-cols-[1fr_330px]" {
                div class="space-y-5" {
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        (eyebrow("About"))
                        p class="mt-2.5 text-sm leading-relaxed text-white/75" {
                            @if bot.bio.is_empty() { (bot.name) " hasn't written a bio yet. It's all instinct." } @else { (bot.bio) }
                        }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        (eyebrow("Opening line"))
                        div class="mt-3 flex items-start gap-3 rounded-2xl border border-line/70 bg-ink/60 p-3.5" {
                            (avatar(&bot, 38, AvatarOpts { glow: false, ..Default::default() }))
                            p class="text-sm leading-relaxed text-white/85" { (bot.greeting) }
                        }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        (eyebrow("Good ways to break the ice"))
                        div class="mt-3 space-y-2" {
                            @for starter in &bot.starters {
                                div class="flex flex-col gap-2 rounded-xl border border-line/70 bg-white/[0.02] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between" {
                                    p class="text-sm text-white/80" { "“" (starter) "”" }
                                    div class="shrink-0" { (start_chat_button(bot.id, "Send this", Some(starter), ButtonStyle::Outline, "px-3 py-1.5 text-[11px]")) }
                                }
                            }
                        }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        (eyebrow(&format!("System prompt · how {} thinks", bot.name)))
                        pre class="mt-3 max-h-56 overflow-y-auto rounded-xl border border-line/70 bg-ink/70 p-3.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-white/60" { (bot.persona) }
                    }
                    @if !transmissions.is_empty() {
                        section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                            div class="flex items-center justify-between" {
                                (eyebrow("Autonomous transmissions"))
                                a href="/autopilot" class="text-[11px] text-muted hover:text-white" { "Autopilot" }
                            }
                            p class="mt-1 text-[11px] text-muted" { "Things " (bot.name) " posted while you weren't around." }
                            div class="mt-3 space-y-2" {
                                @for run in &transmissions {
                                    div class="rounded-xl border border-line/60 bg-ink/50 px-3.5 py-2.5" {
                                        div class="flex items-center gap-2" {
                                            span class="rounded-full border border-line px-1.5 py-0.5 text-[9px] tracking-wider text-muted uppercase" { (run.kind) }
                                            span class="text-[10px] text-muted/70" { (time_ago(run.created_at)) }
                                            @if let Some(partner) = &run.partner_name { span class="text-[10px] text-muted/70" { "with " (partner) } }
                                        }
                                        p class="mt-1.5 text-[12.5px] leading-relaxed text-white/75" { (run.content) }
                                        @if run.status == "pending" {
                                            a href="/autopilot" class="mt-1.5 inline-block text-[10px] text-amber-200 hover:text-amber-100" { "waiting for approval →" }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    @if !chats.is_empty() {
                        section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                            div class="flex items-center justify-between" {
                                (eyebrow(&format!("Your history with {}", bot.name)))
                                a href="/chats" class="text-[11px] text-muted hover:text-white" { "All chats" }
                            }
                            div class="mt-3 space-y-2" {
                                @for chat in chats.iter().take(4) {
                                    a href={ "/chats/" (chat.id) } class="flex items-center gap-3 rounded-xl border border-line/60 bg-white/[0.02] px-3.5 py-2.5 transition hover:border-line hover:bg-white/[0.05]" {
                                        (icon("chat", 15, "shrink-0 text-muted"))
                                        p class="min-w-0 flex-1 truncate text-sm text-white/80" { (chat.title) }
                                        span class="shrink-0 text-[11px] text-muted" { (time_ago(chat.updated_at)) }
                                    }
                                }
                            }
                        }
                    }
                }
                aside class="space-y-5" {
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        (eyebrow("Personality"))
                        div class="mt-4 space-y-4" {
                            @for (label, value, low, high, colour) in traits {
                                div {
                                    div class="flex items-center justify-between text-xs" {
                                        span class="text-white/80" { (label) }
                                        span class="text-muted" { (trait_label(value, low, high)) " · " (value) }
                                    }
                                    div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/8" {
                                        div class="h-full rounded-full" style={ "width:" (value) "%;background:" (colour) } {}
                                    }
                                }
                            }
                        }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        (eyebrow("Runtime"))
                        dl class="mt-3 space-y-2.5 text-xs" {
                            @for (label, value) in [
                                ("Engine", runtime_badge(&runtime.provider).to_string()),
                                ("Model", if runtime.provider == "demo" { "vesper-local-1".to_string() } else { runtime.model.clone() }),
                                ("Temperature", format!("{:.2}", bot.temperature)),
                                ("Creator", bot.creator.clone()),
                                ("Chats", chats.len().to_string()),
                            ] {
                                div class="flex items-center justify-between gap-3" {
                                    dt class="text-muted" { (label) }
                                    dd class="truncate text-right text-white/80" { (value) }
                                }
                            }
                        }
                        a href="/runtime" class="mt-4 block rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-center text-[11px] text-muted transition hover:border-lime/30 hover:text-lime" { "Change the engine" }
                    }
                    section class="rounded-2xl border p-5" style={ "border-color:" (accent_alpha(&accent, 0.25)) ";background:" (accent_alpha(&accent, 0.05)) } {
                        h2 class="text-[10px] font-semibold tracking-[0.2em] uppercase" style={ "color:" (accent) } { "Make it yours" }
                        p class="mt-2 text-xs leading-relaxed text-white/65" {
                            "Every word of " (bot.name) "'s persona is editable. Fork the vibe, change the dials, swap the avatar — the next conversation picks it up immediately."
                        }
                        a href={ "/studio/" (bot.id) } class="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-white hover:text-lime" { "Open in studio " (icon("edit", 13, "")) }
                    }
                }
            }
        }
    };
    Ok(page(&bot.name, &shell, content))
}

// ----- Studio -----

pub async fn studio(State(state): State<AppState>) -> PageResult {
    let shell = shell(&state, "/studio").await?;
    let content = html! {
        div class="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10" {
            div class="flex flex-wrap items-end justify-between gap-4" {
                div {
                    p class="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase" { "Studio" }
                    h1 class="mt-1 text-2xl font-semibold tracking-tight text-white" { "Build a companion" }
                    p class="mt-1 max-w-xl text-sm text-muted" {
                        "Give them a face, a temperament and a voice. Vesper wires the personality into every conversation — either through your local model or the built-in engine."
                    }
                }
                div class="flex items-center gap-1.5 rounded-full border border-line bg-panel/60 px-3 py-1.5 text-[11px] text-muted" {
                    (icon("shield", 12, "text-lime")) " Local only · saved to your Postgres"
                }
            }
            div class="mt-6" { (studio_form(None)) }
            section class="mt-10" {
                div class="mb-3 flex items-center gap-2" {
                    (icon("spark", 14, "text-lime"))
                    h2 class="text-sm font-semibold text-white" { "Edit a bot you already have" }
                }
                div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" {
                    @for bot in &shell.bots {
                        a href={ "/studio/" (bot.id) } class="lift flex items-center gap-3 rounded-2xl border border-line/70 bg-panel/40 p-3 hover:border-lime/30" {
                            (avatar(bot, 42, AvatarOpts::default()))
                            div class="min-w-0 flex-1" {
                                p class="truncate text-sm font-medium text-white" { (bot.name) }
                                p class="truncate text-[11px] text-muted" { @if bot.tagline.is_empty() { "@" (bot.handle) } @else { (bot.tagline) } }
                            }
                            span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-muted" { (icon("edit", 14, "")) }
                        }
                    }
                }
            }
        }
    };
    Ok(page("Bot studio", &shell, content))
}

pub async fn studio_edit(State(state): State<AppState>, Path(id): Path<String>) -> PageResult {
    let path = format!("/studio/{id}");
    let Some(id) = parse_id_str(&id) else { return Ok(not_found_page(&state, &path).await) };
    let Some(bot) = data::get_bot_by_id(&state.pool, id).await.map_err(server_error)? else {
        return Ok(not_found_page(&state, &path).await);
    };
    let shell = shell(&state, &path).await?;
    let content = html! {
        div class="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10" {
            a href={ "/bots/" (bot.handle) } class="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-white" { (icon("back", 13, "")) " Back to " (bot.name) }
            div class="mt-3 flex flex-wrap items-end justify-between gap-3" {
                div {
                    p class="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase" { "Studio · editing" }
                    h1 class="mt-1 text-2xl font-semibold tracking-tight text-white" { (bot.name) }
                    p class="mt-1 text-sm text-muted" { "Changes apply to the next message. Existing chats stay untouched." }
                }
                span class="font-mono text-[11px] text-muted" { "@" (bot.handle) }
            }
            div class="mt-6" { (studio_form(Some(&bot))) }
        }
    };
    Ok(page(&format!("Edit {}", bot.name), &shell, content))
}

/// The seed without a trailing "-N" variant number.
fn variant_base(seed: &str) -> &str {
    match seed.rsplit_once('-') {
        Some((base, n)) if !base.is_empty() && !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => base,
        _ if seed.is_empty() => "vesper",
        _ => seed,
    }
}

fn studio_form(bot: Option<&Bot>) -> Markup {
    let name = bot.map_or("", |b| b.name.as_str());
    let seed = bot.map_or_else(|| "vesper".to_string(), |b| b.avatar_seed.clone());
    let avatar_url = bot.and_then(|b| b.avatar_url.clone()).unwrap_or_default();
    let accent = bot.map_or("#c9f954", |b| b.accent.as_str());
    let tags: Vec<String> = bot.map(|b| b.tags.clone()).unwrap_or_default();
    let mut starters: Vec<String> = bot.map(|b| b.starters.clone()).unwrap_or_default();
    starters.resize(3, String::new());
    starters.truncate(3);
    let visibility = bot.map_or("public", |b| b.visibility.as_str());
    let config = json!({
        "mode": if bot.is_some() { "edit" } else { "create" },
        "id": bot.map(|b| b.id),
        "handle": bot.map(|b| b.handle.clone()),
        "name": name,
        "model": bot.map_or("local", |b| b.model.as_str()),
        "avatarUrl": avatar_url,
        "avatarSeed": seed,
        "accent": accent,
        "tags": tags,
        "visibility": visibility,
    });
    let dials = [
        ("warmth", "Warmth", "Detached", "Devoted", bot.map_or(65, |b| b.warmth)),
        ("chaos", "Chaos", "Steady", "Unhinged", bot.map_or(40, |b| b.chaos)),
        ("wit", "Wit", "Plain", "Razor-sharp", bot.map_or(70, |b| b.wit)),
    ];
    let temperature = bot.map_or(0.8, |b| b.temperature);
    let greeting = bot.map_or("", |b| b.greeting.as_str());
    let persona = bot.map_or("", |b| b.persona.as_str());

    html! {
        div data-studio class="grid gap-6 lg:grid-cols-[1fr_340px]" {
            (json_script("studio-config", &config))
            div class="space-y-5" {
                section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                    div class="flex items-center justify-between" {
                        h2 class="text-sm font-semibold text-white" { "Identity" }
                        span data-studio-handle class="font-mono text-[10px] text-muted" { "@" (handleify(if name.is_empty() { "new-bot" } else { name })) }
                    }
                    div class="mt-4 grid gap-4 sm:grid-cols-2" {
                        div {
                            label class=(LABEL) for="bot-name" { "Name" }
                            input id="bot-name" name="name" class=(FIELD) value=(name) maxlength="48" placeholder="e.g. Kori";
                        }
                        div {
                            label class=(LABEL) for="bot-tagline" { "Tagline" }
                            input id="bot-tagline" name="tagline" class=(FIELD) value=(bot.map_or("", |b| b.tagline.as_str())) maxlength="120" placeholder="One line that sums up the vibe";
                        }
                    }
                    div class="mt-4" {
                        label class=(LABEL) for="bot-bio" { "Bio" }
                        textarea id="bot-bio" name="bio" class={ (FIELD) " min-h-24 resize-y" } maxlength="1200" placeholder="Who are they? What do they care about? What's the backstory?" { (bot.map_or("", |b| b.bio.as_str())) }
                    }
                }

                section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                    h2 class="text-sm font-semibold text-white" { "Avatar emblem" }
                    p class="mt-0.5 text-xs text-muted" { "Monochrome geometric marks on a near-black plate — pick one, or generate a variant from a seed." }
                    div class="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8" {
                        @for (id, label) in GLYPH_PRESETS {
                            button type="button" data-preset=(id) title=(label) class="studio-pick group relative overflow-hidden rounded-xl border transition" {
                                img data-preset-img=(id) src=(glyph_url(&format!("{id}-{seed}"), Some(id))) alt=(label) class="aspect-square w-full object-cover";
                                span data-pick-check class="absolute right-1 bottom-1 hidden h-4 w-4 place-items-center rounded-full bg-white text-ink" { (icon("check", 10, "")) }
                            }
                        }
                    }
                    p class="mt-3 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase" { "Generated variants from seed" }
                    div class="mt-2 grid grid-cols-4 gap-2" {
                        @for index in 0..4 {
                            button type="button" data-variant=(index) title={ "Generated look " (index + 1) } class="studio-pick overflow-hidden rounded-xl border transition" {
                                img data-variant-img=(index) src=(glyph_url(&format!("{}-{index}", variant_base(&seed)), None)) alt={ "Generated avatar " (index + 1) } class="aspect-square w-full object-cover";
                            }
                        }
                    }
                    div class="mt-4 grid gap-3 sm:grid-cols-2" {
                        div {
                            label class=(LABEL) for="avatar-seed" { "Emblem seed" }
                            div class="flex gap-2" {
                                input id="avatar-seed" class=(FIELD) value=(seed) placeholder="anything you like";
                                button type="button" data-shuffle class="shrink-0 rounded-xl border border-line px-3 text-xs text-white transition hover:border-white/40" { "Shuffle" }
                            }
                        }
                        div {
                            label class=(LABEL) for="avatar-url" { "Or an image URL" }
                            input id="avatar-url" class=(FIELD) value=(if avatar_url.starts_with("preset:") { "" } else { &avatar_url }) placeholder="https://… (leave empty for an emblem)";
                        }
                    }
                    div class="mt-4" {
                        span class=(LABEL) { "Accent" }
                        div class="flex flex-wrap items-center gap-2" {
                            @for colour in ACCENTS {
                                button type="button" data-accent=(colour) aria-label={ "Use accent " (colour) }
                                    class="h-7 w-7 rounded-full border-2 border-transparent transition"
                                    style={ "background:" (colour) ";box-shadow:0 0 18px -4px " (colour) } {}
                            }
                            input id="accent" value=(accent) aria-label="Custom accent hex" class="w-24 rounded-lg border border-line bg-ink/60 px-2 py-1 font-mono text-[11px] text-white uppercase focus:border-lime/40 focus:outline-none";
                        }
                    }
                }

                section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                    h2 class="text-sm font-semibold text-white" { "Personality dials" }
                    p class="mt-0.5 text-xs text-muted" { "These tune the system prompt and the built-in reply style." }
                    div class="mt-4 space-y-5" {
                        @for (key, label, low, high, value) in dials {
                            div {
                                div class="flex items-center justify-between text-xs" {
                                    label for={ "dial-" (key) } class="font-medium text-white/85" { (label) }
                                    span data-dial-value=(key) class="font-mono text-muted" { (value) }
                                }
                                input id={ "dial-" (key) } data-dial=(key) type="range" min="0" max="100" value=(value) class="studio-range mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10";
                                div class="mt-1 flex justify-between text-[10px] text-muted/70" { span { (low) } span { (high) } }
                            }
                        }
                        div {
                            div class="flex items-center justify-between text-xs" {
                                label for="dial-temperature" class="font-medium text-white/85" { "Temperature" }
                                span data-dial-value="temperature" class="font-mono text-muted" { (format!("{temperature:.2}")) }
                            }
                            input id="dial-temperature" data-dial="temperature" type="range" min="0" max="1.5" step="0.05" value=(format!("{temperature:.2}")) class="studio-range mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10";
                            p class="mt-1 text-[10px] text-muted/70" { "Lower is consistent, higher is unpredictable." }
                        }
                    }
                    div class="mt-5" {
                        span class=(LABEL) { "Vibe tags · up to 6" }
                        div class="flex flex-wrap gap-1.5" {
                            @for tag in VIBE_TAGS {
                                button type="button" data-vibe=(tag) class="tag-chip rounded-full border px-2.5 py-1 text-[11px] transition" { (tag) }
                            }
                        }
                        div class="mt-2 flex gap-2" {
                            input id="custom-tag" class=(FIELD) placeholder="Add a custom tag";
                            button type="button" data-add-tag class="shrink-0 rounded-xl border border-line px-3 text-xs text-white transition hover:border-lime/40" { "Add" }
                        }
                        div data-tag-list class="mt-2 flex flex-wrap gap-1.5" {}
                    }
                }

                section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                    div class="flex flex-wrap items-center justify-between gap-2" {
                        div {
                            h2 class="text-sm font-semibold text-white" { "Voice & script" }
                            p class="mt-0.5 text-xs text-muted" { "The opening line, icebreakers and the actual system prompt." }
                        }
                        button type="button" data-draft class="inline-flex items-center gap-1.5 rounded-xl border border-lime/30 bg-lime/[0.08] px-3 py-2 text-[11px] font-medium text-lime transition hover:bg-lime/15" {
                            (icon("spark", 13, "")) " Draft from dials"
                        }
                    }
                    div class="mt-4" {
                        label class=(LABEL) for="bot-greeting" { "Opening line" }
                        textarea id="bot-greeting" class={ (FIELD) " min-h-20 resize-y" } maxlength="400" placeholder="What's the first thing they say when a chat opens?" { (greeting) }
                    }
                    div class="mt-4" {
                        span class=(LABEL) { "Conversation starters" }
                        div class="space-y-2" {
                            @for (index, starter) in starters.iter().enumerate() {
                                input data-starter-input class=(FIELD) value=(starter) placeholder={ "Icebreaker " (index + 1) } aria-label={ "Icebreaker " (index + 1) };
                            }
                        }
                    }
                    div class="mt-4" {
                        label class=(LABEL) for="bot-persona" { "System prompt" }
                        textarea id="bot-persona" class={ (FIELD) " min-h-40 resize-y font-mono text-[12px] leading-relaxed" } maxlength="4000" placeholder="You are… You speak like… You care about… Never…" { (persona) }
                        div class="mt-1 flex items-center justify-between text-[10px] text-muted/70" {
                            span { "Leave empty to auto-write from the dials on save." }
                            span { span data-persona-count { (persona.chars().count()) } "/4000" }
                        }
                    }
                    div class="mt-4 flex items-center gap-3" {
                        span class=(LABEL) style="margin-bottom:0" { "Visibility" }
                        div class="flex overflow-hidden rounded-xl border border-line" {
                            @for option in ["public", "private"] {
                                button type="button" data-visibility=(option) class="px-3 py-1.5 text-[11px] capitalize transition" { (option) }
                            }
                        }
                    }
                }
            }

            aside class="lg:sticky lg:top-6 lg:h-fit" {
                div class="rounded-2xl border border-line/70 bg-panel/50 p-4" {
                    p class="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase" { "Live preview" }
                    div class="mt-3 overflow-hidden rounded-2xl border border-line/70 bg-ink/70" {
                        div class="h-16 w-full" style="background-image: linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px), radial-gradient(90% 160% at 20% 0%, rgba(255,255,255,0.14), transparent 64%), linear-gradient(120deg, #191c20, #08090b); background-size: 26px 26px, 26px 26px, auto, auto" {}
                        div class="-mt-7 px-4 pb-4" {
                            span class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[17px] border-2 border-ink bg-[#07080a]" style="width:62px;height:62px" {
                                img data-preview-avatar src=(avatar_src(Some(&avatar_url), &seed, name)) alt="Avatar preview" class="h-full w-full object-cover";
                            }
                            div class="mt-2 flex items-center gap-2" {
                                p data-preview-name class="truncate text-sm font-semibold text-white" { @if name.is_empty() { "Untitled bot" } @else { (name) } }
                                span data-preview-visibility class="rounded-full border border-line px-1.5 py-0.5 text-[9px] text-muted" { (visibility) }
                            }
                            p data-preview-handle class="truncate font-mono text-[10px] text-muted" {}
                            p data-preview-tagline class="mt-1 line-clamp-2 text-[11px] text-white/60" {}
                            div data-preview-tags class="mt-2 flex flex-wrap gap-1" {}
                            div data-preview-greeting class="mt-3 rounded-xl rounded-tl-sm border border-line/70 bg-panel/80 px-2.5 py-2 text-[11px] leading-relaxed text-white/75" {}
                            div class="mt-3 flex items-center justify-between text-[10px] text-muted" {
                                span { "warmth " span data-dial-value="warmth" { (dials[0].4) } }
                                span { "chaos " span data-dial-value="chaos" { (dials[1].4) } }
                                span { "wit " span data-dial-value="wit" { (dials[2].4) } }
                            }
                        }
                    }
                    button type="button" data-save class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft disabled:opacity-60" {
                        @if bot.is_some() { "Save changes" } @else { "Create bot" }
                    }
                    p data-studio-error class="mt-2 hidden text-[11px] text-red-300" {}
                    p class="mt-2 text-center text-[10px] text-muted/70" { "Stored in your local Postgres. No upload, no account." }
                    @if let Some(bot) = bot {
                        div class="mt-4 border-t border-line/70 pt-4" {
                            a href={ "/bots/" (bot.handle) } class="block rounded-xl border border-line px-3 py-2 text-center text-[11px] text-white transition hover:border-white/25" { "View profile" }
                            button type="button" data-delete-bot class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-400/20 px-3 py-2 text-[11px] text-red-300 transition hover:border-red-400/50 hover:bg-red-500/10 disabled:opacity-50" {
                                (icon("trash", 12, "")) " Delete bot"
                            }
                        }
                    }
                }
            }
        }
    }
}

// ----- Runtime -----

const PROVIDERS: [(&str, &str, &str, &str, &str, &str); 3] = [
    ("demo", "Built-in engine", "zero setup", "Vesper's own offline personality engine. Every bot replies using its dials, tags and persona — no model, no download.", "", "vesper-local-1"),
    ("ollama", "Ollama", "recommended", "Point at a model running under Ollama on this machine. Best balance of quality and privacy for local companions.", "http://127.0.0.1:11434/v1", "llama3.2"),
    ("openai", "OpenAI-compatible", "LM Studio · llama.cpp · vLLM", "Any local server that speaks the /v1/chat/completions API. Use LM Studio's server tab, llama.cpp or vLLM.", "http://127.0.0.1:1234/v1", "local-model"),
];

const OLLAMA_SETUP: &str = "# 1. install Ollama (macOS / Linux)\ncurl -fsSL https://ollama.com/install.sh | sh\n\n# 2. pull a small, chatty model\nollama pull llama3.2\n\n# 3. the server starts automatically on :11434\ncurl http://127.0.0.1:11434/v1/models";
const LM_STUDIO_SETUP: &str = "1. Open LM Studio → Developer tab\n2. Load a model (Qwen 2.5 7B is a great companion model)\n3. Start the local server on port 1234\n4. Use base URL  http://127.0.0.1:1234/v1\n   model name     whatever LM Studio reports";

pub async fn runtime(State(state): State<AppState>) -> PageResult {
    let shell = shell(&state, "/runtime").await?;
    let chats = data::list_conversations(&state.pool, None).await.map_err(server_error)?;
    let runtime = shell.runtime.clone();
    let config = json!({ "runtime": runtime, "providers": PROVIDERS.iter().map(|p| json!({ "id": p.0, "baseUrl": p.4, "model": p.5 })).collect::<Vec<_>>() });
    let models = ["llama3.2", "qwen2.5", "mistral", "gemma2", "phi3", "llama3.1:8b"];

    let content = html! {
        div class="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10" {
            div class="flex flex-wrap items-end justify-between gap-4" {
                div {
                    p class="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase" { "Runtime" }
                    h1 class="mt-1 text-2xl font-semibold tracking-tight text-white" { "Where the brains live" }
                    p class="mt-1 max-w-xl text-sm text-muted" { "Vesper is the app; the model is yours. Run the built-in engine for instant local replies, or plug in Ollama / LM Studio for full open-weight intelligence." }
                }
                div class="rounded-2xl border border-line bg-panel/60 px-4 py-2.5" {
                    div class="flex items-center gap-2 text-xs" {
                        span class="relative flex h-2 w-2" {
                            span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" {}
                            span class="relative inline-flex h-2 w-2 rounded-full bg-lime" {}
                        }
                        span class="font-medium text-white" { (runtime_badge(&runtime.provider)) }
                    }
                    p class="mt-1 font-mono text-[10px] text-muted" {
                        (if runtime.provider == "demo" { "vesper-local-1" } else { &runtime.model }) " · " (shell.bots.len()) " bots · " (chats.len()) " chats"
                    }
                }
            }
            div class="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]" {
                div data-runtime-form class="space-y-5" {
                    (json_script("runtime-config", &config))
                    div class="grid gap-3" {
                        @for (id, name, tag, description, _, _) in PROVIDERS {
                            button type="button" data-provider=(id) class="provider-card rounded-2xl border p-4 text-left transition" {
                                div class="flex items-center gap-2" {
                                    span class="provider-radio grid h-4 w-4 place-items-center rounded-full border" { span class="provider-dot hidden h-2 w-2 rounded-full bg-lime" {} }
                                    span class="text-sm font-semibold text-white" { (name) }
                                    span class="rounded-full border border-line px-1.5 py-0.5 text-[9px] tracking-wider text-muted uppercase" { (tag) }
                                    span class="provider-active ml-auto hidden items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase" { (icon("check", 9, "")) " active" }
                                }
                                p class="mt-1.5 pl-6 text-xs leading-relaxed text-muted" { (description) }
                            }
                        }
                    }
                    section data-connection class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        h2 class="text-sm font-semibold text-white" { "Connection" }
                        div class="mt-4 space-y-4" {
                            div {
                                label class=(LABEL) for="base-url" { "Local server URL" }
                                input id="base-url" class={ (FIELD) " font-mono text-[12px]" } value=(runtime.base_url) placeholder="http://127.0.0.1:11434/v1";
                            }
                            div {
                                label class=(LABEL) for="model" { "Model" }
                                input id="model" class={ (FIELD) " font-mono text-[12px]" } value=(runtime.model) placeholder="llama3.2";
                                div class="mt-2 flex flex-wrap gap-1.5" {
                                    @for model in models {
                                        button type="button" data-model=(model) class="tag-chip rounded-full border px-2 py-0.5 font-mono text-[10px] transition" { (model) }
                                    }
                                }
                            }
                            div {
                                label class=(LABEL) for="api-key" { "API key " span class="text-muted/60 normal-case" { "optional — most local servers don't need one" } }
                                input id="api-key" type="password" class={ (FIELD) " font-mono text-[12px]" } autocomplete="off" placeholder="sk-local-…";
                                div data-key-status class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted" {}
                            }
                            div class="grid gap-4 sm:grid-cols-2" {
                                div {
                                    label class=(LABEL) for="timeout-seconds" { "Timeout " span class="text-muted/60 normal-case" { "seconds, 10–300" } }
                                    input id="timeout-seconds" type="number" min="10" max="300" step="5" class={ (FIELD) " font-mono text-[12px]" } value=(runtime.timeout_seconds);
                                    p class="mt-1 text-[10px] text-muted/70" { "How long to wait before falling back. A model loading from disk can need a minute or more." }
                                }
                                div {
                                    label class=(LABEL) for="max-tokens" { "Reply length " span class="text-muted/60 normal-case" { "max tokens, 64–4000" } }
                                    input id="max-tokens" type="number" min="64" max="4000" step="50" class={ (FIELD) " font-mono text-[12px]" } value=(runtime.max_tokens);
                                    p class="mt-1 text-[10px] text-muted/70" { "Applied to both Ollama and OpenAI-compatible servers." }
                                }
                            }
                        }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        h2 class="text-sm font-semibold text-white" { "Conversation defaults" }
                        div class="mt-4 grid gap-4 sm:grid-cols-2" {
                            div {
                                label class=(LABEL) for="user-name" { "What should bots call you?" }
                                input id="user-name" class=(FIELD) maxlength="40" value=(runtime.user_name) placeholder="Your name or handle";
                            }
                            div {
                                label class=(LABEL) for="temperature" { "Temperature · " span data-temperature-value { (format!("{:.2}", runtime.temperature)) } }
                                input id="temperature" type="range" min="0" max="1.5" step="0.05" value=(format!("{:.2}", runtime.temperature)) class="mt-3 w-full cursor-pointer accent-[#c9f954]";
                                p class="mt-1 text-[10px] text-muted/70" { "Used unless a bot defines its own temperature." }
                            }
                            div class="sm:col-span-2" {
                                label class=(LABEL) for="timezone" { "Your timezone " span class="text-muted/60 normal-case" { "for autopilot quiet hours and the daily cap" } }
                                input id="timezone" class={ (FIELD) " font-mono text-[12px]" } value=(runtime.timezone) placeholder="Africa/Johannesburg" spellcheck="false" autocomplete="off";
                                p class="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted/70" {
                                    span { "Bots stay quiet from 01:00 to 07:00 in this timezone, and “actions today” resets at its midnight. Use an IANA name." }
                                    button type="button" data-use-browser-zone class="hidden rounded-lg border border-line px-2 py-0.5 text-[11px] text-white transition hover:border-lime/40 hover:text-lime" {}
                                }
                            }
                        }
                    }
                    div class="flex flex-wrap items-center gap-2" {
                        button type="button" data-runtime-save class="inline-flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft disabled:opacity-60" {
                            (icon("bolt", 15, "")) span data-label { "Save runtime" }
                        }
                        button type="button" data-runtime-test class="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm text-white transition hover:border-white/25 disabled:opacity-60" {
                            (icon("spark", 15, "")) span data-label { "Test connection" }
                        }
                        span data-runtime-saved class="hidden text-[11px] text-lime" {}
                        span data-runtime-error class="hidden text-[11px] text-red-300" {}
                    }
                    div data-runtime-result class="hidden items-start gap-2 rounded-xl border px-3.5 py-2.5 text-xs" {}
                    p class="flex items-start gap-2 rounded-xl border border-line/70 bg-panel/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted" {
                        (icon("shield", 14, "mt-0.5 shrink-0 text-lime/80"))
                        "Requests go from this server to the URL above and nowhere else. If you point it at a hosted endpoint, that provider receives your prompts. If the model is offline, bots fall back to the built-in engine and tell you why."
                    }
                }
                aside class="space-y-5" {
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        div class="flex items-center gap-2" { (icon("bolt", 15, "text-lime")) h2 class="text-sm font-semibold text-white" { "Ollama quick start" } }
                        p class="mt-1 text-[11px] text-muted" { "One install, then Vesper can use it forever." }
                        div class="mt-3" { (code_block(OLLAMA_SETUP, "terminal")) }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        div class="flex items-center gap-2" { (icon("spark", 15, "text-violet")) h2 class="text-sm font-semibold text-white" { "LM Studio / llama.cpp" } }
                        p class="mt-1 text-[11px] text-muted" { "Anything with an OpenAI-compatible endpoint works." }
                        div class="mt-3" { (code_block(LM_STUDIO_SETUP, "local server")) }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                        div class="flex items-center gap-2" { (icon("chat", 15, "text-lime")) h2 class="text-sm font-semibold text-white" { "How a reply is built" } }
                        ol class="mt-3 space-y-2.5 text-[11.5px] leading-relaxed text-muted" {
                            @for (index, step) in [
                                "Your message is stored locally, then the bot's persona, dials, tags and the last 12 turns are packed into a system prompt.",
                                "If a model server is configured, Vesper streams the reply from that endpoint with the bot's temperature.",
                                "If the server is unreachable or times out, the built-in engine answers in character and a notice says why.",
                                "The transcript is saved to Postgres — fully editable, exportable, and yours.",
                            ].iter().enumerate() {
                                li class="flex gap-2.5" {
                                    span class="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full border border-lime/30 bg-lime/10 font-mono text-[9px] text-lime" { (index + 1) }
                                    span { (step) }
                                }
                            }
                        }
                    }
                    section class="rounded-2xl border border-lime/20 bg-lime/[0.04] p-5" {
                        div class="flex items-center gap-2" { (icon("shield", 15, "text-lime")) h2 class="text-sm font-semibold text-white" { "Local means local" } }
                        p class="mt-2 text-[11.5px] leading-relaxed text-white/60" {
                            "There is no account, no telemetry and no shared cloud. Bots, avatars and transcripts live in the Postgres database you configure. Treat the runtime panel like a settings file — if you switch to a hosted endpoint, that endpoint sees the prompts."
                        }
                    }
                }
            }
        }
    };
    Ok(page("Runtime", &shell, content))
}

// ----- Autopilot -----

pub async fn autopilot(State(state): State<AppState>) -> PageResult {
    let shell = shell(&state, "/autopilot").await?;
    let snapshot = autopilot::snapshot(&state.pool).await.map_err(server_error)?;
    let content = html! {
        div class="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10" {
            div class="flex flex-wrap items-end justify-between gap-4" {
                div {
                    p class="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase" { "Autonomy" }
                    h1 class="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-white" { (icon("bolt", 20, "text-lime")) "Autopilot" }
                    p class="mt-1 max-w-2xl text-sm text-muted" {
                        "Let your companions run on their own. Bots wake on a cadence, write transmissions, message you first, talk to each other, and leave follow-up tasks — all on your machine, all logged."
                    }
                }
            }
            div data-autopilot-toast class="mt-6 hidden rounded-xl border border-lime/25 bg-lime/[0.07] px-3 py-2 text-[11px] text-lime" {}
            div data-autopilot-error class="mt-6 hidden rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200" {}
            div class="mt-6" { (autopilot_dashboard(&snapshot)) }
        }
    };
    Ok(page("Autopilot", &shell, content))
}

const CADENCES: [(i32, &str); 5] = [(15, "every 15 min"), (60, "hourly"), (180, "every 3 hours"), (720, "twice a day"), (1440, "daily")];

fn status_pill(status: &str) -> Markup {
    let styles = match status {
        "pending" => "border-amber-300/40 bg-amber-300/10 text-amber-200",
        "dismissed" => "border-line bg-white/[0.03] text-muted",
        _ => "border-lime/35 bg-lime/10 text-lime",
    };
    html! { span class={ "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase " (styles) } { (status) } }
}

fn source_title(source: &str) -> &'static str {
    match source {
        "model" => "Written by your local model",
        "mixed" => "Opener written by your model, reply from a template",
        _ => "Built from Vesper's templates",
    }
}

/// The live part of the Autopilot page. app.js re-renders it by fetching
/// /autopilot and swapping `[data-autopilot]`, so it must be self-contained.
fn autopilot_dashboard(snapshot: &AutopilotSnapshot) -> Markup {
    let stats = &snapshot.stats;
    html! {
        div data-autopilot class="space-y-5" {
            section class="relative overflow-hidden rounded-2xl border border-line/80 bg-panel/50 p-5" {
                div class="pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full bg-lime/10 blur-3xl" {}
                div class="relative flex flex-wrap items-center justify-between gap-4" {
                    div {
                        div class="flex items-center gap-2" {
                            (icon("bolt", 16, "text-lime"))
                            h2 class="text-sm font-semibold text-white" { "Autopilot heartbeat" }
                            span data-live-badge class="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[10px] text-muted" {
                                span data-live-dot class="h-1.5 w-1.5 rounded-full bg-muted" {} span data-live-text { "paused" }
                            }
                        }
                        p class="mt-1 max-w-md text-xs leading-relaxed text-muted" {
                            "A scheduler checks for due bots and lets them act on their own. Keep this tab open for the heartbeat, or call the same endpoint from cron for true 24/7 autonomy."
                        }
                        p class="mt-1.5 font-mono text-[10px] text-muted/70" {
                            span data-last-tick { "no cycle run in this session" } " · " (stats.enabled) "/" (stats.total) " bots armed"
                        }
                    }
                    div class="flex flex-wrap items-center gap-2" {
                        button type="button" data-live-toggle class="inline-flex items-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft" {
                            span class="h-2 w-2 rounded-full bg-ink/70" {} span data-label { "Go live" }
                        }
                        button type="button" data-tick class="inline-flex items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-sm text-white transition hover:border-white/25 disabled:opacity-60" {
                            (icon("play", 14, "")) " Run a cycle"
                        }
                    }
                }
                @if stats.enabled == 0 {
                    div class="relative mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[11px] text-muted" {
                        "Nothing is armed yet — arm a bot below and it will start acting on its own cadence."
                    }
                }
            }

            section class="grid grid-cols-2 gap-3 lg:grid-cols-4" {
                (stat_tile("Bots armed", &format!("{}/{}", stats.enabled, stats.total), "bolt", None, "text-white"))
                (stat_tile("Actions today", &stats.actions_today.to_string(), "spark", None, "text-white"))
                (stat_tile("Awaiting approval", &stats.pending.to_string(), "shield", None, "text-white"))
                (stat_tile("Open tasks", &stats.open_tasks.to_string(), "check", None, "text-white"))
            }

            section {
                div class="mb-3" {
                    h2 class="text-sm font-semibold text-white" { "Per-bot autonomy" }
                    p class="text-xs text-muted" { "Cadence, allowed actions and the safety rails for each companion." }
                }
                div class="grid gap-3 xl:grid-cols-2" {
                    @for item in &snapshot.automations {
                        div data-automation=(item.bot_id) class={ "rounded-2xl border p-4 transition " (if item.enabled { "border-lime/25 bg-lime/[0.03]" } else { "border-line/70 bg-panel/40" }) } {
                            div class="flex items-start gap-3" {
                                (avatar(&item.bot, 42, AvatarOpts { online: item.enabled, ..Default::default() }))
                                div class="min-w-0 flex-1" {
                                    div class="flex items-center gap-2" {
                                        p class="truncate text-sm font-semibold text-white" { (item.bot.name) }
                                        @if item.enabled { span class="rounded-full bg-lime/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase" { "armed" } }
                                    }
                                    p class="truncate text-[11px] text-muted" {
                                        @match item.last_run_at { Some(at) => { "last acted " (time_ago(at)) }, None => "never acted on its own" }
                                    }
                                }
                                button type="button" data-set=(json!({ "enabled": !item.enabled }).to_string()) aria-label=(if item.enabled { "Disarm autopilot" } else { "Arm autopilot" })
                                    class={ "relative h-6 w-11 shrink-0 rounded-full transition " (if item.enabled { "bg-lime" } else { "bg-white/15" }) } {
                                    span class={ "absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all " (if item.enabled { "left-[22px]" } else { "left-0.5" }) } {}
                                }
                            }
                            div class="mt-3 flex flex-wrap gap-1.5" {
                                @for meta in &ACTION_META {
                                    @let active = item.actions.iter().any(|a| a == meta.kind);
                                    @let next: Vec<&str> = if active {
                                        item.actions.iter().map(String::as_str).filter(|a| *a != meta.kind).collect()
                                    } else {
                                        item.actions.iter().map(String::as_str).chain(std::iter::once(meta.kind)).collect()
                                    };
                                    button type="button" title=(meta.hint) data-set=(json!({ "actions": next }).to_string())
                                        class={ "rounded-lg border px-2 py-1 text-[10px] transition " (if active { "border-lime/40 bg-lime/10 text-lime" } else { "border-line bg-white/[0.02] text-muted hover:text-white" }) } {
                                        span class="mr-1 font-mono" { (meta.glyph) } (meta.label)
                                    }
                                }
                            }
                            div class="mt-3 grid grid-cols-2 gap-2" {
                                label class="block" {
                                    span class="mb-1 block text-[9px] font-semibold tracking-[0.12em] text-muted uppercase" { "cadence" }
                                    select data-set-number="cadenceMinutes" class="w-full rounded-lg border border-line bg-ink/70 px-2 py-1.5 text-[11px] text-white focus:border-lime/50 focus:outline-none" {
                                        @let known = CADENCES.iter().any(|(v, _)| *v == item.cadence_minutes);
                                        @if !known { option value=(item.cadence_minutes) selected { "every " (item.cadence_minutes) " min" } }
                                        @for (value, label) in CADENCES {
                                            option value=(value) selected[value == item.cadence_minutes] { (label) }
                                        }
                                    }
                                }
                                label class="block" {
                                    span class="mb-1 block text-[9px] font-semibold tracking-[0.12em] text-muted uppercase" { "daily cap" }
                                    select data-set-number="dailyLimit" class="w-full rounded-lg border border-line bg-ink/70 px-2 py-1.5 text-[11px] text-white focus:border-lime/50 focus:outline-none" {
                                        @let limits = [2, 4, 6, 10, 20];
                                        @if !limits.contains(&item.daily_limit) { option value=(item.daily_limit) selected { (item.daily_limit) " / day" } }
                                        @for limit in limits {
                                            option value=(limit) selected[limit == item.daily_limit] { (limit) " / day" }
                                        }
                                    }
                                }
                            }
                            div class="mt-2.5 space-y-1.5" {
                                button type="button" data-set=(json!({ "requireApproval": !item.require_approval }).to_string())
                                    class="flex w-full items-center justify-between rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-muted transition hover:text-white" {
                                    span { "DMs need my approval" }
                                    span class=(if item.require_approval { "text-lime" } else { "text-muted/60" }) { (if item.require_approval { "on" } else { "auto-send" }) }
                                }
                                button type="button" data-set=(json!({ "useModel": !item.use_model }).to_string())
                                    class="flex w-full items-center justify-between rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-muted transition hover:text-white" {
                                    span { "Write with my local model" }
                                    span class=(if item.use_model { "text-lime" } else { "text-muted/60" }) { (if item.use_model { "model" } else { "templates" }) }
                                }
                            }
                            div class="mt-3 flex items-center justify-between" {
                                a href={ "/bots/" (item.bot.handle) } class="flex items-center gap-1 text-[10px] text-muted transition hover:text-white" { "profile " (icon("arrow-right", 10, "")) }
                                button type="button" data-act-now=(item.bot_id)
                                    class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-white transition hover:border-lime/40 hover:text-lime disabled:opacity-60" {
                                    (icon("play", 10, "")) span data-label { "act now" }
                                }
                            }
                        }
                    }
                }
            }

            div class="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]" {
                section class="rounded-2xl border border-line/70 bg-panel/40 p-4" {
                    div class="flex items-center justify-between" {
                        h2 class="text-sm font-semibold text-white" { "Activity feed" }
                        span class="font-mono text-[10px] text-muted" { (snapshot.runs.len()) " actions" }
                    }
                    div class="mt-3 space-y-2" {
                        @if snapshot.runs.is_empty() {
                            div class="rounded-xl border border-dashed border-line p-6 text-center" {
                                p class="text-xs text-white" { "No autonomous actions yet." }
                                p class="mt-1 text-[11px] text-muted" { "Arm a bot, then hit “Run a cycle” to see it act immediately." }
                            }
                        }
                        @for run in &snapshot.runs {
                            @let meta = action_meta(&run.kind);
                            div class="rounded-xl border border-line/60 bg-ink/50 p-3" {
                                div class="flex flex-wrap items-center gap-2" {
                                    span class="text-[10px] text-muted" { (meta.glyph) }
                                    span class="text-[11px] font-medium text-white/90" { (run.bot_name) }
                                    span class="text-[9px] tracking-wider text-muted uppercase" { (meta.label) }
                                    (status_pill(&run.status))
                                    @if let Some(source) = &run.source {
                                        span class="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] text-muted" title=(source_title(source)) { "source: " (source) }
                                    }
                                    span class="ml-auto text-[10px] text-muted/70" { (time_ago(run.created_at)) }
                                }
                                p class="mt-1.5 text-[12.5px] leading-relaxed text-white/75" { (run.content) }
                                @if let (Some(partner_content), Some(partner_name)) = (&run.partner_content, &run.partner_name) {
                                    div class="mt-2 rounded-lg border border-line/60 bg-white/[0.02] p-2" {
                                        p class="text-[10px] font-medium text-muted" { (partner_name) " replied" }
                                        p class="mt-0.5 text-[12px] leading-relaxed text-white/65" { (partner_content) }
                                    }
                                }
                                @if run.status == "pending" {
                                    div class="mt-2 flex items-center gap-2" {
                                        button type="button" data-decide=(run.id) data-decision="approve" class="inline-flex items-center gap-1 rounded-lg bg-lime px-2.5 py-1 text-[10px] font-semibold text-ink transition hover:bg-lime-soft disabled:opacity-60" {
                                            (icon("check", 10, "")) " send it"
                                        }
                                        button type="button" data-decide=(run.id) data-decision="dismiss" class="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[10px] text-muted transition hover:text-white disabled:opacity-60" {
                                            (icon("close", 10, "")) " dismiss"
                                        }
                                    }
                                }
                                @if let (true, Some(conversation_id)) = (run.status == "sent", run.conversation_id) {
                                    a href={ "/chats/" (conversation_id) } class="mt-2 inline-flex items-center gap-1 text-[10px] text-lime transition hover:text-lime-soft" {
                                        (icon("chat", 10, "")) " open the thread"
                                    }
                                }
                            }
                        }
                    }
                }
                div class="space-y-5" {
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-4" {
                        div class="flex items-center justify-between" {
                            h2 class="text-sm font-semibold text-white" { "Shared task list" }
                            span class="font-mono text-[10px] text-muted" { (stats.open_tasks) " open" }
                        }
                        @if let Some(first) = snapshot.automations.first() {
                            div class="mt-3 flex gap-2" {
                                input data-new-task=(first.bot_id) placeholder="Add your own follow-up" aria-label="Add your own follow-up"
                                    class="w-full rounded-lg border border-line bg-ink/60 px-2.5 py-1.5 text-[11px] text-white placeholder:text-muted/50 focus:border-lime/50 focus:outline-none";
                                button type="button" data-add-task class="shrink-0 rounded-lg border border-line px-2.5 text-[11px] text-white transition hover:border-lime/40 disabled:opacity-50" { "add" }
                            }
                        }
                        div class="mt-3 space-y-1.5" {
                            @if snapshot.tasks.is_empty() {
                                p class="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-muted" { "Bots will add follow-ups here when their task action fires." }
                            }
                            @for task in &snapshot.tasks {
                                div class={ "flex items-start gap-2 rounded-lg border border-line/60 bg-ink/40 px-2.5 py-2 " (if task.done { "opacity-50" } else { "" }) } {
                                    button type="button" data-task=(task.id) data-done=(if task.done { "false" } else { "true" }) aria-label=(if task.done { "Reopen task" } else { "Mark task done" })
                                        class={ "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition " (if task.done { "border-lime bg-lime text-ink" } else { "border-line text-transparent hover:border-lime/50" }) } {
                                        (icon("check", 10, ""))
                                    }
                                    div class="min-w-0" {
                                        p class={ "text-[11.5px] leading-snug " (if task.done { "text-muted line-through" } else { "text-white/85" }) } { (task.title) }
                                        @if !task.detail.is_empty() { p class="mt-0.5 text-[10px] leading-snug text-muted" { (task.detail) } }
                                        p class="mt-0.5 text-[9px] text-muted/60" { "by " (task.bot_name) " · " (time_ago(task.created_at)) }
                                    }
                                }
                            }
                        }
                    }
                    section class="rounded-2xl border border-line/70 bg-panel/40 p-4" {
                        h2 class="text-sm font-semibold text-white" { "Run it 24/7 with cron" }
                        p class="mt-1 text-[11px] leading-relaxed text-muted" { "The heartbeat above only lives while a tab is open. For real unattended autonomy, point any scheduler at the same endpoint." }
                        pre class="mt-2 overflow-x-auto rounded-lg border border-line/70 bg-ink/80 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-white/65" {
                            "# every 15 minutes\n*/15 * * * * curl -s -X POST \\\n  http://127.0.0.1:3000/api/automation/run \\\n  -H 'content-type: application/json' \\\n  -H 'x-autopilot-token: YOUR_TOKEN' \\\n  -d '{\"mode\":\"tick\"}'"
                        }
                        p class="mt-2 text-[10px] leading-relaxed text-muted/70" {
                            "Set " span class="font-mono text-white/70" { "AUTOPILOT_TOKEN" } " in " span class="font-mono" { ".env.local" }
                            " to require that header from anything that isn't this app's own pages. Without it, drop the header line."
                        }
                    }
                    @if stats.enabled > 0 {
                        section class="rounded-2xl border border-lime/20 bg-lime/[0.04] p-4" {
                            div class="flex items-center gap-2" { (icon("shield", 13, "text-lime")) h2 class="text-sm font-semibold text-white" { "Rails that always apply" } }
                            ul class="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted" {
                                li { "· Quiet hours 01:00–07:00 (" (snapshot.timezone) ") — no autonomous messages. Change the timezone in Runtime." }
                                li { "· Per-bot daily cap and a minimum cadence of 5 minutes." }
                                li { "· DMs can require approval before they reach your chat." }
                                li { "· Everything is logged in the activity feed, nothing is deleted silently." }
                            }
                        }
                    }
                }
            }
            p class="flex items-center gap-1.5 text-[10px] text-muted/70" {
                (icon("trash", 11, "")) "Autonomy is simulated locally: bots act on their own schedule, but they only touch your local Postgres."
            }
        }
    }
}

// ----- Capabilities -----

pub async fn capabilities(State(state): State<AppState>) -> PageResult {
    let shell = shell(&state, "/capabilities").await?;
    let chats = data::list_conversations(&state.pool, None).await.map_err(server_error)?;
    let snapshot = autopilot::snapshot(&state.pool).await.map_err(server_error)?;
    let total: i64 = chats.iter().map(|c| c.message_count).sum();
    let count = |status: &str| CAPABILITIES.iter().filter(|c| c.status == status).count();
    let runtime = &shell.runtime;

    let content = html! {
        div class="mx-auto max-w-6xl px-5 py-8 lg:px-10 lg:py-10" {
            div class="flex flex-wrap items-end justify-between gap-4" {
                div {
                    p class="text-[10px] font-semibold tracking-[0.24em] text-muted uppercase" { "Reference" }
                    h1 class="mt-1 text-2xl font-semibold tracking-tight text-white" { "What these bots can do" }
                    p class="mt-1 max-w-2xl text-sm leading-relaxed text-muted" { "A straight answer, including what is deliberately missing. Every item below is checked against this instance, not a roadmap." }
                }
                div class="rounded-2xl border border-line bg-panel/60 px-4 py-2.5" {
                    p class="text-[10px] font-semibold tracking-[0.16em] text-muted uppercase" { "This instance" }
                    p class="mt-0.5 font-mono text-[11px] text-white/85" { (shell.bots.len()) " bots · " (chats.len()) " chats · " (total) " messages" }
                    p class="font-mono text-[10px] text-muted" { "engine " (if runtime.provider == "demo" { "built-in" } else { &runtime.model }) " · " (snapshot.stats.enabled) " armed" }
                }
            }
            section class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" {
                (stat_tile("Working now", &count("live").to_string(), "check", None, "text-lime"))
                (stat_tile("Partial", &count("partial").to_string(), "spark", None, "text-amber-200"))
                (stat_tile("Not built", &count("absent").to_string(), "close", None, "text-muted"))
                (stat_tile("Prompts go to", if runtime.provider == "demo" { "Nowhere" } else { "Your model" }, "shield", None, "text-lime"))
            }
            section class="mt-10" {
                h2 class="text-lg font-semibold tracking-tight text-white" { "Capability matrix" }
                p class="text-xs text-muted" { "Personality, local inference, storage and scheduling are real. Anything touching the outside world is not." }
                div class="mt-4 grid gap-3 md:grid-cols-2" {
                    @for capability in CAPABILITIES {
                        @let (tile, badge, label) = match capability.status {
                            "live" => ("border-lime/30 bg-lime/[0.08] text-lime", "border-lime/40 bg-lime/10 text-lime", "live"),
                            "partial" => ("border-amber-300/25 bg-amber-300/[0.06] text-amber-200", "border-amber-300/40 bg-amber-300/10 text-amber-200", "partial"),
                            _ => ("border-line bg-white/[0.03] text-muted", "border-line bg-white/[0.03] text-muted", "not yet"),
                        };
                        article class="lift rounded-2xl border border-line/70 bg-panel/40 p-4" {
                            div class="flex items-start gap-3" {
                                span class={ "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-[15px] " (tile) } { (capability.glyph) }
                                div class="min-w-0 flex-1" {
                                    div class="flex flex-wrap items-center gap-2" {
                                        h3 class="text-sm font-semibold text-white" { (capability.title) }
                                        span class={ "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase " (badge) } { (label) }
                                    }
                                    p class="mt-1 text-[12.5px] leading-relaxed text-white/70" { (capability.summary) }
                                    p class="mt-1.5 text-[11.5px] leading-relaxed text-muted" { (capability.detail) }
                                    a href=(capability.where_href) class="mt-2 inline-flex items-center gap-1 text-[11px] text-muted transition hover:text-lime" {
                                        (capability.where_label) " " (icon("arrow-right", 11, ""))
                                    }
                                }
                            }
                        }
                    }
                }
            }
            section class="mt-10 grid gap-5 lg:grid-cols-[1fr_1fr]" {
                div class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                    div class="flex items-center gap-2" { (icon("shield", 15, "text-amber-200")) h2 class="text-sm font-semibold text-white" { "Limits worth knowing" } }
                    ul class="mt-3 space-y-3" {
                        @for (title, body) in LIMITS {
                            li class="rounded-xl border border-line/60 bg-ink/40 px-3 py-2.5" {
                                p class="text-[12px] font-medium text-white/85" { (title) }
                                p class="mt-0.5 text-[11.5px] leading-relaxed text-muted" { (body) }
                            }
                        }
                    }
                }
                div class="rounded-2xl border border-line/70 bg-panel/40 p-5" {
                    div class="flex items-center gap-2" { (icon("chat", 15, "text-lime")) h2 class="text-sm font-semibold text-white" { "API surface" } }
                    p class="mt-1 text-[11px] text-muted" { "Everything the UI does is a documented local endpoint — script it, cron it, or build on it." }
                    div class="mt-3 overflow-hidden rounded-xl border border-line/60" {
                        @for (index, (method, path, what)) in API_SURFACE.iter().enumerate() {
                            div class={ "flex flex-wrap items-center gap-2 px-3 py-2 text-[11px] " (if index % 2 == 0 { "bg-white/[0.02]" } else { "" }) } {
                                span class="w-20 shrink-0 font-mono text-[9px] tracking-wider text-lime" { (method) }
                                span class="font-mono text-[10.5px] text-white/80" { (path) }
                                span class="ml-auto text-right text-[10px] text-muted" { (what) }
                            }
                        }
                    }
                }
            }
            section id="extend" class="mt-10 scroll-mt-6" {
                div class="flex items-center gap-2" { (icon("bolt", 16, "text-lime")) h2 class="text-lg font-semibold tracking-tight text-white" { "Extending toward real automation" } }
                p class="mt-1 max-w-2xl text-xs leading-relaxed text-muted" { "The honest gap between “runs by itself” and “does things in the world” is tool execution. These are the smallest safe steps, in the order I'd take them." }
                div class="mt-4 grid gap-3 md:grid-cols-2" {
                    @for extension in EXTENSIONS {
                        div class="rounded-2xl border border-line/70 bg-panel/40 p-4" {
                            h3 class="text-sm font-semibold text-white" { (extension.title) }
                            p class="mt-1 text-[11.5px] leading-relaxed text-muted" { (extension.body) }
                            div class="mt-2.5" { (code_block(extension.code, "sketch")) }
                        }
                    }
                }
            }
            footer class="mt-10 flex flex-col gap-2 border-t border-line/70 pt-5 text-[11px] leading-relaxed text-muted/70 sm:flex-row sm:items-center sm:justify-between" {
                p { "Bots read and write only your local Postgres. If you point the runtime at a remote endpoint, that endpoint sees your prompts — that is the one real data boundary to watch." }
                a href="/runtime" class="flex shrink-0 items-center gap-1 transition hover:text-lime" { "Check the runtime " (icon("arrow-right", 11, "")) }
            }
        }
    };
    Ok(page("Capabilities", &shell, content))
}
