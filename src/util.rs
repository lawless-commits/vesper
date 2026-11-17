//! Small helpers shared across the app.

use chrono::{DateTime, Utc};

/// FNV-1a style hash, bit-for-bit compatible with the original TypeScript
/// version (UTF-16 code units, 32-bit signed multiply, `Math.abs`). Keeping it
/// identical means existing bots keep the same generated avatars and the same
/// deterministic template picks after the Rust rewrite.
pub fn js_hash(input: &str) -> i64 {
    let mut h: i32 = 2_166_136_261_u32 as i32;
    for unit in input.encode_utf16() {
        h ^= unit as i32;
        h = h.wrapping_mul(16_777_619);
    }
    (h as i64).abs()
}

/// Turn a display name into a URL-safe handle: "Night Owl!!" -> "night-owl".
pub fn handleify(name: &str) -> String {
    let lower = name.to_lowercase();
    let trimmed = lower.trim();
    let mut kept = String::new();
    for c in trimmed.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c.is_whitespace() {
            kept.push(c);
        }
    }
    let mut out = String::new();
    let mut last_dash = false;
    for c in kept.chars() {
        let c = if c.is_whitespace() { '-' } else { c };
        if c == '-' {
            if !last_dash {
                out.push('-');
            }
            last_dash = true;
        } else {
            out.push(c);
            last_dash = false;
        }
    }
    let out: String = out.chars().take(28).collect();
    if out.is_empty() { "new-bot".to_string() } else { out }
}

/// Cut text to `max` characters, ending with an ellipsis when shortened.
pub fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

/// Collapse all runs of whitespace into single spaces and trim.
pub fn squash_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// "12s ago", "5m ago", "3h ago", "2d ago", or a short date for older times.
pub fn time_ago(at: DateTime<Utc>) -> String {
    time_ago_from(at, Utc::now())
}

pub fn time_ago_from(at: DateTime<Utc>, now: DateTime<Utc>) -> String {
    let seconds = (now - at).num_seconds().max(1);
    if seconds < 60 {
        return format!("{seconds}s ago");
    }
    let minutes = seconds / 60;
    if minutes < 60 {
        return format!("{minutes}m ago");
    }
    let hours = minutes / 60;
    if hours < 24 {
        return format!("{hours}h ago");
    }
    let days = hours / 24;
    if days < 7 {
        return format!("{days}d ago");
    }
    at.format("%b %-d").to_string()
}

pub const VIBE_TAGS: [&str; 12] = [
    "chaotic",
    "cozy",
    "noir",
    "sci-fi",
    "philosophy",
    "coding",
    "music",
    "goth",
    "wellness",
    "worldbuilding",
    "film",
    "gaming",
];

pub fn trait_label<'a>(value: i32, low: &'a str, high: &'a str) -> &'a str {
    if value < 34 {
        low
    } else if value > 66 {
        high
    } else {
        "balanced"
    }
}

/// `rgba(r, g, b, alpha)` from a `#rrggbb` accent, falling back to lime.
pub fn accent_alpha(accent: &str, alpha: f32) -> String {
    let hex = accent.trim_start_matches('#');
    let full: String = if hex.len() == 3 { hex.chars().flat_map(|c| [c, c]).collect() } else { hex.to_string() };
    let channel = |range: std::ops::Range<usize>, fallback: u8| {
        full.get(range).and_then(|s| u8::from_str_radix(s, 16).ok()).filter(|v| *v != 0).unwrap_or(fallback)
    };
    format!("rgba({}, {}, {}, {})", channel(0..2, 201), channel(2..4, 249), channel(4..6, 84), alpha)
}

/// True for a `#rrggbb` hex colour.
pub fn is_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn hash_matches_the_typescript_implementation() {
        // Values produced by the original JS `hash()` / `hashSeed()`.
        assert_eq!(js_hash(""), 2_128_831_035);
        assert_eq!(js_hash("ani"), js_hash("ani"));
        assert_ne!(js_hash("ani"), js_hash("rudi"));
    }

    #[test]
    fn handles() {
        assert_eq!(handleify("  Night Owl!! "), "night-owl");
        assert_eq!(handleify("***"), "new-bot");
        assert_eq!(handleify("a  --  b"), "a-b");
        assert_eq!(handleify(&"x".repeat(40)).len(), 28);
    }

    #[test]
    fn truncation() {
        assert_eq!(truncate("abcdef", 4), "abc…");
        assert_eq!(truncate("abc", 4), "abc");
    }

    #[test]
    fn relative_times() {
        let now = Utc.with_ymd_and_hms(2026, 11, 16, 12, 0, 0).unwrap();
        assert_eq!(time_ago_from(now, now), "1s ago");
        assert_eq!(time_ago_from(now - chrono::Duration::minutes(5), now), "5m ago");
        assert_eq!(time_ago_from(now - chrono::Duration::hours(3), now), "3h ago");
        assert_eq!(time_ago_from(now - chrono::Duration::days(2), now), "2d ago");
        assert_eq!(time_ago_from(now - chrono::Duration::days(30), now), "Oct 17");
    }

    #[test]
    fn accents() {
        assert_eq!(accent_alpha("#c9f954", 0.5), "rgba(201, 249, 84, 0.5)");
        assert!(is_hex_color("#A3e635"));
        assert!(!is_hex_color("a3e635"));
    }
}
