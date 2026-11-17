//! Shared page chrome and components, rendered with maud.

use maud::{DOCTYPE, Markup, PreEscaped, html};

use crate::avatar::avatar_src;
use crate::icons::icon;
use crate::models::{Bot, RuntimeView};
use crate::util::accent_alpha;

pub const FIELD: &str = "w-full rounded-xl border border-line bg-ink/60 px-3 py-2.5 text-sm text-white placeholder:text-muted/50 focus:border-lime/50 focus:ring-2 focus:ring-lime/10 focus:outline-none";
pub const LABEL: &str = "mb-1.5 block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase";

/// Everything the sidebar needs.
pub struct Shell {
    pub path: String,
    pub bots: Vec<Bot>,
    pub runtime: RuntimeView,
}

const NAV: [(&str, &str, &str); 6] = [
    ("/", "Discover", "compass"),
    ("/chats", "Your chats", "chat"),
    ("/autopilot", "Autopilot", "bolt"),
    ("/studio", "Bot studio", "wand"),
    ("/runtime", "Runtime", "sliders"),
    ("/capabilities", "Capabilities", "shield"),
];

fn is_active(path: &str, href: &str) -> bool {
    if href == "/" { path == "/" } else { path == href || path.starts_with(&format!("{href}/")) }
}

fn brand() -> Markup {
    html! {
        a href="/" class="group flex items-center gap-3" {
            span class="relative grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-lime to-[#6ee7b7] text-ink shadow-[0_14px_30px_-12px_rgba(201,249,84,0.8)]" {
                span class="text-[17px] font-black tracking-tighter" { "V" }
                span class="absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full border-2 border-ink bg-violet" {}
            }
            span class="leading-none" {
                span class="block text-[17px] font-semibold tracking-[0.18em] text-white" { "VESPER" }
                span class="mt-1 block text-[10px] tracking-[0.22em] text-muted uppercase" { "Local companion studio" }
            }
        }
    }
}

fn sidebar(shell: &Shell, mobile: bool) -> Markup {
    let provider_label = match shell.runtime.provider.as_str() {
        "ollama" => format!("Ollama · {}", shell.runtime.model),
        "openai" => format!("Local API · {}", shell.runtime.model),
        _ => "Built-in engine".to_string(),
    };
    html! {
        div class="flex h-full flex-col gap-6 p-5" {
            div class="flex items-center justify-between" {
                (brand())
                @if mobile {
                    button type="button" data-menu-close class="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted" aria-label="Close menu" {
                        (icon("close", 16, ""))
                    }
                }
            }
            a href="/studio" class="flex items-center justify-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-lime-soft" {
                (icon("plus", 16, "")) "Create a bot"
            }
            nav class="space-y-1" {
                @for (href, label, glyph) in NAV {
                    @let active = is_active(&shell.path, href);
                    a href=(href) class={ "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition " (if active { "bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" } else { "text-muted hover:bg-white/[0.04] hover:text-white" }) } {
                        (icon(glyph, 18, if active { "text-lime" } else { "text-muted group-hover:text-white/80" }))
                        span class="font-medium" { (label) }
                        @if active { span class="ml-auto h-1.5 w-1.5 rounded-full bg-lime" {} }
                    }
                }
            }
            div class="min-h-0 flex-1 overflow-y-auto" {
                p class="mb-2 px-3 text-[10px] font-semibold tracking-[0.2em] text-muted/70 uppercase" { "In your roster" }
                div class="space-y-1" {
                    @for bot in shell.bots.iter().take(5) {
                        a href={ "/bots/" (bot.handle) } class="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-muted transition hover:bg-white/[0.04] hover:text-white" {
                            (avatar(bot, 26, AvatarOpts { glow: false, ..Default::default() }))
                            span class="truncate" { (bot.name) }
                            span class="ml-auto font-mono text-[10px] text-muted/60" { "@" (bot.handle) }
                        }
                    }
                    @if shell.bots.is_empty() { p class="px-3 text-xs text-muted/70" { "No bots yet." } }
                }
            }
            a href="/runtime" class="rounded-2xl border border-line bg-panel/70 p-3 transition hover:border-line/80 hover:bg-panel" {
                div class="flex items-center gap-2 text-xs" {
                    span class="relative flex h-2 w-2" {
                        span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime opacity-60" {}
                        span class="relative inline-flex h-2 w-2 rounded-full bg-lime" {}
                    }
                    span class="font-medium text-white/90" { "Runtime ready" }
                    (icon("bolt", 13, "ml-auto text-lime"))
                }
                p class="mt-1.5 truncate text-[11px] text-muted" { (provider_label) }
                p class="mt-2 text-[10px] text-muted/60" { "Runs on your machine. Prompts go only to the model server you set." }
            }
        }
    }
}

/// The full HTML document: sidebar, mobile header and the page content.
pub fn layout(title: &str, shell: &Shell, content: Markup) -> Markup {
    let full_title = if title.is_empty() { "Vesper — Local Companion Studio".to_string() } else { format!("{title} · Vesper") };
    html! {
        (DOCTYPE)
        html lang="en" {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { (full_title) }
                meta name="description" content="Build, host and chat with your own AI companions. Character avatars, personalities and full chat history, all running on your machine.";
                link rel="icon" href="/icon.svg" type="image/svg+xml";
                link rel="stylesheet" href="/static/app.css";
                script src="/static/app.js" defer {}
            }
            body class="min-h-screen antialiased" {
                div class="app-bg grain min-h-screen" {
                    aside class="fixed inset-y-0 left-0 z-40 hidden w-[272px] border-r border-line/70 bg-ink/70 backdrop-blur-xl lg:block" {
                        (sidebar(shell, false))
                    }
                    header class="sticky top-0 z-40 flex items-center justify-between border-b border-line/70 bg-ink/85 px-4 py-3 backdrop-blur-xl lg:hidden" {
                        (brand())
                        button type="button" data-menu-open class="grid h-10 w-10 place-items-center rounded-xl border border-line text-white" aria-label="Open menu" {
                            (icon("menu", 18, ""))
                        }
                    }
                    div id="mobile-menu" class="fixed inset-0 z-50 hidden lg:hidden" {
                        button type="button" data-menu-close aria-label="Close menu overlay" class="absolute inset-0 bg-black/70 backdrop-blur-sm" {}
                        div class="animate-pop absolute inset-y-0 left-0 w-[290px] border-r border-line bg-ink" {
                            (sidebar(shell, true))
                        }
                    }
                    main class="lg:pl-[272px]" { (content) }
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
pub struct AvatarOpts<'a> {
    pub class: &'a str,
    pub glow: bool,
    pub online: bool,
}

impl Default for AvatarOpts<'_> {
    fn default() -> Self {
        AvatarOpts { class: "", glow: true, online: false }
    }
}

pub fn avatar(bot: &Bot, size: u32, opts: AvatarOpts) -> Markup {
    avatar_from(&avatar_src(bot.avatar_url.as_deref(), &bot.avatar_seed, &bot.name), &bot.name, size, opts)
}

pub fn avatar_from(src: &str, name: &str, size: u32, opts: AvatarOpts) -> Markup {
    let radius = std::cmp::max(8, (size as f32 * 0.28).round() as u32);
    let shadow = if opts.glow { "box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 12px 28px -14px rgba(0,0,0,0.95);" } else { "" };
    let dot = std::cmp::max(6, (size as f32 * 0.14).round() as u32);
    html! {
        span class={ "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/12 bg-[#07080a] " (opts.class) }
            style={ "width:" (size) "px;height:" (size) "px;border-radius:" (radius) "px;" (shadow) } {
            img src=(src) alt={ (name) " avatar" } width=(size) height=(size) class="h-full w-full object-cover" loading="lazy";
            @if opts.online {
                span class="absolute right-1 bottom-1 block rounded-full bg-white/90 ring-2 ring-ink" style={ "width:" (dot) "px;height:" (dot) "px" } {}
            }
        }
    }
}

pub fn bot_card(bot: &Bot) -> Markup {
    let accent = if bot.accent.is_empty() { "#c9f954" } else { &bot.accent };
    let tags = bot.tags.join(" ");
    html! {
        a href={ "/bots/" (bot.handle) } data-bot-card data-name=(bot.name.to_lowercase()) data-handle=(bot.handle) data-tagline=(bot.tagline.to_lowercase()) data-tags=(tags)
            class="lift group relative flex flex-col overflow-hidden rounded-3xl border border-line/80 bg-panel/60 p-4"
            style="box-shadow: inset 0 1px 0 rgba(255,255,255,0.04)" {
            div class="pointer-events-none absolute -top-24 -right-16 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-100"
                style={ "background:" (accent_alpha(accent, 0.28)) } {}
            div class="relative flex items-start gap-4" {
                (avatar(bot, 58, AvatarOpts { online: true, ..Default::default() }))
                div class="min-w-0" {
                    div class="flex items-center gap-2" {
                        h3 class="truncate text-[15px] font-semibold text-white" { (bot.name) }
                        @if bot.featured {
                            span class="inline-flex items-center gap-1 rounded-full border border-lime/25 bg-lime/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-lime uppercase" {
                                (icon("spark", 9, "")) "featured"
                            }
                        }
                    }
                    p class="truncate font-mono text-[11px] text-muted" { "@" (bot.handle) }
                    p class="mt-1.5 line-clamp-2 text-[13px] leading-snug text-white/60" { (bot.tagline) }
                }
            }
            div class="relative mt-3 flex flex-wrap gap-1.5" {
                @for tag in bot.tags.iter().take(3) {
                    span class="rounded-full border border-line/80 bg-white/[0.03] px-2 py-0.5 text-[10px] text-muted" { (tag) }
                }
            }
            div class="relative mt-3 flex items-center justify-between border-t border-line/60 pt-2.5" {
                span class="flex items-center gap-1.5 text-[11px] text-muted" {
                    span class="h-1.5 w-1.5 rounded-full" style={ "background:" (accent) } {}
                    @if bot.chat_count > 0 {
                        (bot.chat_count) " chat" @if bot.chat_count != 1 { "s" }
                    } @else { "Ready to chat" }
                }
                span class="flex items-center gap-1 text-[11px] font-medium text-white/70 transition group-hover:text-white" {
                    "Open " (icon("arrow-right", 13, ""))
                }
            }
        }
    }
}

pub fn create_bot_card() -> Markup {
    html! {
        a href="/studio" class="group flex min-h-[188px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-line bg-panel/30 p-6 text-center transition hover:border-lime/40 hover:bg-lime/[0.04]" {
            span class="grid h-12 w-12 place-items-center rounded-2xl border border-line bg-white/[0.03] text-muted transition group-hover:border-lime/40 group-hover:text-lime" {
                span class="text-xl leading-none" { "+" }
            }
            span class="text-sm font-semibold text-white" { "Make your own" }
            span class="max-w-[190px] text-xs leading-relaxed text-muted" { "Pick an avatar, dial in a personality, and give them a voice." }
        }
    }
}

pub enum ButtonStyle {
    Primary,
    Outline,
}

/// Opens a new conversation with the bot (via /api/conversations) and goes to
/// it; with `prompt`, that message is sent as soon as the chat opens.
pub fn start_chat_button(bot_id: i32, label: &str, prompt: Option<&str>, style: ButtonStyle, size: &str) -> Markup {
    let colours = match style {
        ButtonStyle::Primary => "bg-lime text-ink hover:bg-lime-soft",
        ButtonStyle::Outline => "border border-line bg-white/[0.03] text-white hover:border-lime/40 hover:bg-lime/[0.06]",
    };
    html! {
        div {
            button type="button" data-start-chat=(bot_id) data-prompt=[prompt]
                class={ "inline-flex w-full items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-wait disabled:opacity-70 " (size) " " (colours) } {
                (icon("chat", 16, "")) span data-label { (label) }
            }
            p data-error class="mt-2 hidden text-xs text-red-300" {}
        }
    }
}

pub fn code_block(code: &str, label: &str) -> Markup {
    html! {
        div class="overflow-hidden rounded-xl border border-line/80 bg-ink/80" {
            div class="flex items-center justify-between border-b border-line/70 px-3 py-1.5" {
                span class="font-mono text-[10px] tracking-wider text-muted uppercase" { (label) }
                button type="button" data-copy class="flex items-center gap-1 text-[10px] text-muted transition hover:text-lime" {
                    (icon("copy", 11, "")) span data-copy-label { "copy" }
                }
            }
            pre data-copy-source class="overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-white/70" { (code) }
        }
    }
}

/// Small uppercase heading used on panels.
pub fn eyebrow(text: &str) -> Markup {
    html! { h2 class="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase" { (text) } }
}

/// JSON embedded in the page for app.js, safe inside a <script> element.
pub fn json_script(id: &str, value: &serde_json::Value) -> Markup {
    let json = value.to_string().replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026");
    html! { script type="application/json" id=(id) { (PreEscaped(json)) } }
}
