//! Inline SVG icons (24x24, stroke = currentColor).

use maud::{Markup, PreEscaped, html};

fn paths(name: &str) -> &'static str {
    match name {
        "compass" => r#"<circle cx="12" cy="12" r="9"/><path d="m15.4 8.6-2.1 5.3-5.3 2.1 2.1-5.3z"/>"#,
        "chat" => r#"<path d="M20 15.2A2.8 2.8 0 0 1 17.2 18H9l-4 3v-6.2A2.8 2.8 0 0 1 3.4 12V6.8A2.8 2.8 0 0 1 6.2 4h11A2.8 2.8 0 0 1 20 6.8z"/>"#,
        "wand" => r#"<path d="m4 20 9.5-9.5"/><path d="M14.5 4.5 15.6 7l2.5 1.1-2.5 1.1L14.5 12l-1.1-2.8L11 8.1 13.4 7z"/><path d="M19 14.5 19.8 16l1.5.8-1.5.8L19 19.2l-.8-1.6L16.7 16.8l1.5-.8z"/>"#,
        "sliders" => r#"<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>"#,
        "plus" => r#"<path d="M12 5v14M5 12h14"/>"#,
        "arrow-right" => r#"<path d="M5 12h14M13 6l6 6-6 6"/>"#,
        "send" => r#"<path d="M20 4 10.5 20l-1.6-6.9L2 11.5z"/><path d="m20 4-11 9"/>"#,
        "search" => r#"<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>"#,
        "menu" => r#"<path d="M4 7h16M4 12h16M4 17h16"/>"#,
        "close" => r#"<path d="M6 6l12 12M18 6 6 18"/>"#,
        "trash" => r#"<path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12.2A1.8 1.8 0 0 0 9 21h6a1.8 1.8 0 0 0 1.8-1.8L17.5 7"/>"#,
        "copy" => r#"<rect x="9" y="9" width="11" height="11" rx="2.4"/><path d="M15 9V6.4A2.4 2.4 0 0 0 12.6 4H6.4A2.4 2.4 0 0 0 4 6.4v6.2A2.4 2.4 0 0 0 6.4 15H9"/>"#,
        "check" => r#"<path d="m5 13 4.5 4.5L19 7"/>"#,
        "spark" => r#"<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8"/>"#,
        "bolt" => r#"<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/>"#,
        "back" => r#"<path d="M19 12H5M11 6l-6 6 6 6"/>"#,
        "shield" => r#"<path d="M12 3l7 3v5.4c0 4.3-2.9 7.7-7 9.6-4.1-1.9-7-5.3-7-9.6V6z"/><path d="m9 12 2 2 4-4"/>"#,
        "edit" => r#"<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 6.5 3 3"/>"#,
        "play" => r#"<path d="M8 5.5 19 12 8 18.5z"/>"#,
        "volume" => r#"<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15 9.2a4 4 0 0 1 0 5.6M17.8 6.4a8 8 0 0 1 0 11.2"/>"#,
        "volume-off" => r#"<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>"#,
        "stop" => r#"<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>"#,
        _ => "",
    }
}

/// An inline icon of `size` pixels with optional extra classes.
pub fn icon(name: &str, size: u32, class: &str) -> Markup {
    html! {
        svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
            stroke-linejoin="round" width=(size) height=(size) class=(class) aria-hidden="true" {
            (PreEscaped(paths(name)))
        }
    }
}
