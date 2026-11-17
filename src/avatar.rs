//! Generated emblem avatars: a near-black plate, hairline rings, registration
//! ticks and one sharp white geometric mark. Fully deterministic from a seed,
//! and identical to the TypeScript version so existing bots look the same.

use crate::util::js_hash;

pub const ACCENTS: [&str; 8] = ["#c9f954", "#7dd3fc", "#fca5a5", "#c4b5fd", "#fdba74", "#5eead4", "#f9a8d4", "#a3e635"];

pub const GLYPH_PRESETS: [(&str, &str); 8] = [
    ("slash", "Slash"),
    ("orbit", "Orbit"),
    ("chevron", "Chevron"),
    ("prism", "Prism"),
    ("aperture", "Aperture"),
    ("blade", "Blade"),
    ("lattice", "Lattice"),
    ("signal", "Signal"),
];

fn mark(id: &str) -> &'static str {
    match id {
        "slash" => r##"<path d="M-30 40 L4 -40 H28 L-6 40 Z" fill="#f2f3ef"/><path d="M12 40 L46 -40" stroke="rgba(242,243,239,0.32)" stroke-width="3"/>"##,
        "orbit" => r##"<circle r="36" fill="none" stroke="#f2f3ef" stroke-width="4" stroke-dasharray="158 68" transform="rotate(-38)"/><circle cx="28" cy="-26" r="9" fill="#f2f3ef"/><circle r="14" fill="none" stroke="rgba(242,243,239,0.28)" stroke-width="1.5"/>"##,
        "chevron" => r##"<path d="M-36 8 L0 -28 L36 8" fill="none" stroke="#f2f3ef" stroke-width="9" stroke-linejoin="miter" stroke-linecap="square"/><path d="M-36 32 L0 -4 L36 32" fill="none" stroke="rgba(242,243,239,0.34)" stroke-width="4"/>"##,
        "prism" => r##"<path d="M0 -40 L38 30 H-38 Z" fill="none" stroke="#f2f3ef" stroke-width="6" stroke-linejoin="miter"/><path d="M0 -8 L20 26 H-20 Z" fill="#f2f3ef"/>"##,
        "aperture" => r##"<path d="M0 -38 L33 -19 L33 19 L0 38 L-33 19 L-33 -19 Z" fill="none" stroke="#f2f3ef" stroke-width="5" stroke-linejoin="miter"/><path d="M-33 -19 L0 0 L33 -19 M0 38 L0 0" fill="none" stroke="rgba(242,243,239,0.34)" stroke-width="3"/>"##,
        "blade" => r##"<path d="M0 -42 L30 0 L0 42 L-30 0 Z" fill="none" stroke="#f2f3ef" stroke-width="5" stroke-linejoin="miter"/><path d="M-30 0 H30" stroke="rgba(242,243,239,0.38)" stroke-width="2"/><path d="M0 -42 V42" stroke="rgba(242,243,239,0.2)" stroke-width="2"/>"##,
        "lattice" => r##"<g fill="#f2f3ef"><circle cx="-26" cy="-26" r="4.5" opacity="0.55"/><circle cx="0" cy="-26" r="4.5" opacity="0.3"/><circle cx="26" cy="-26" r="4.5" opacity="0.55"/><circle cx="-26" cy="0" r="4.5" opacity="0.3"/><circle cx="0" cy="0" r="7"/><circle cx="26" cy="0" r="4.5" opacity="0.3"/><circle cx="-26" cy="26" r="4.5" opacity="0.55"/><circle cx="0" cy="26" r="4.5" opacity="0.3"/><circle cx="26" cy="26" r="4.5" opacity="0.55"/></g><path d="M-38 -30 V-38 H-30 M30 -38 H38 V-30 M38 30 V38 H30 M-30 38 H-38 V30" fill="none" stroke="rgba(242,243,239,0.35)" stroke-width="2"/>"##,
        _ => r##"<g fill="#f2f3ef"><rect x="-32" y="0" width="8" height="26" rx="2"/><rect x="-16" y="-18" width="8" height="44" rx="2"/><rect x="0" y="-6" width="8" height="32" rx="2"/><rect x="16" y="-30" width="8" height="56" rx="2" opacity="0.55"/><rect x="32" y="-12" width="8" height="38" rx="2" opacity="0.35"/></g>"##,
    }
}

fn mark_for(seed: &str, preset: Option<&str>) -> &'static str {
    let ids: Vec<&'static str> = GLYPH_PRESETS.iter().map(|(id, _)| *id).collect();
    if let Some(found) = preset.and_then(|p| ids.iter().find(|id| **id == p)) {
        return found;
    }
    // Seeds ending in "-N" are generated variants of one base: step the glyph
    // deterministically so a variant row always shows four distinct marks.
    if let Some((base, number)) = seed.rsplit_once('-')
        && !number.is_empty()
        && number.bytes().all(|b| b.is_ascii_digit())
        && let Ok(n) = number.parse::<f64>()
    {
        let index = (js_hash(base) as f64 + n * 3.0) % ids.len() as f64;
        return ids[index as usize];
    }
    ids[(js_hash(seed) as usize) % ids.len()]
}

/// JavaScript's `>>` on a number: convert to int32, then arithmetic shift.
fn js_shr(value: i64, bits: u32) -> i64 {
    ((value as u32 as i32) >> bits) as i64
}

/// JavaScript `%`, which keeps the sign of the dividend.
fn js_rem(a: i64, b: i64) -> i64 {
    a % b
}

/// The emblem as an SVG document.
pub fn glyph_svg(seed: &str, preset: Option<&str>) -> String {
    let seed = if seed.is_empty() { "vesper" } else { seed };
    let h = js_hash(seed);
    let mark = mark(mark_for(seed, preset));
    let rotation = js_rem(js_shr(h, 4), 25) - 12;
    let scale = 0.96 + js_rem(js_shr(h, 9), 11) as f64 / 100.0;
    let ticks: String = [0, 90, 180, 270]
        .iter()
        .map(|a| format!(r#"<line x1="120" y1="22" x2="120" y2="30" transform="rotate({a} 120 120)" stroke="rgba(255,255,255,0.2)" stroke-width="1.25"/>"#))
        .collect();
    let dots: String = [0, 90, 180, 270]
        .iter()
        .map(|a| format!(r#"<circle cx="120" cy="94" r="1.8" transform="rotate({} 120 120)" fill="rgba(255,255,255,0.34)"/>"#, a + 45))
        .collect();
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240"><defs><radialGradient id="plate" cx="32%" cy="18%" r="88%"><stop offset="0%" stop-color="#1b1d20"/><stop offset="52%" stop-color="#101214"/><stop offset="100%" stop-color="#07080a"/></radialGradient><radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.1"/><stop offset="70%" stop-color="#ffffff" stop-opacity="0.02"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect width="240" height="240" fill="url(#plate)"/><circle cx="120" cy="120" r="96" fill="url(#halo)"/><circle cx="120" cy="120" r="76" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1.25"/><circle cx="120" cy="120" r="86" fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>{ticks}{dots}<g transform="translate(120 120) rotate({rotation}) scale({scale:.2})">{mark}</g></svg>"##
    )
}

fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

/// URL of the generated emblem, served by `GET /avatar.svg`.
pub fn glyph_url(seed: &str, preset: Option<&str>) -> String {
    match preset {
        Some(p) => format!("/avatar.svg?seed={}&preset={}", encode(seed), encode(p)),
        None => format!("/avatar.svg?seed={}", encode(seed)),
    }
}

/// The image URL to show for a bot: its custom image, a preset emblem, or a
/// generated emblem from its seed.
pub fn avatar_src(avatar_url: Option<&str>, avatar_seed: &str, name: &str) -> String {
    let seed = if !avatar_seed.is_empty() { avatar_seed } else if !name.is_empty() { name } else { "vesper" };
    match avatar_url.map(str::trim).filter(|u| !u.is_empty()) {
        Some(url) => match url.strip_prefix("preset:") {
            Some(preset) => glyph_url(seed, Some(preset)),
            None => url.to_string(),
        },
        None => glyph_url(seed, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_win() {
        assert!(glyph_svg("ani", Some("orbit")).contains("stroke-dasharray=\"158 68\""));
    }

    #[test]
    fn variants_differ() {
        let marks: std::collections::HashSet<&str> = (0..4).map(|i| mark_for(&format!("kori-{i}"), None)).collect();
        assert_eq!(marks.len(), 4);
    }

    #[test]
    fn sources() {
        assert_eq!(avatar_src(Some("preset:orbit"), "luna", "Luna"), "/avatar.svg?seed=luna&preset=orbit");
        assert_eq!(avatar_src(None, "", "Night Owl"), "/avatar.svg?seed=Night+Owl");
        assert_eq!(avatar_src(Some("https://x.test/a.png"), "s", "n"), "https://x.test/a.png");
    }
}
