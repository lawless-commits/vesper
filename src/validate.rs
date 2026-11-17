//! Input validation shared by API routes and pages. Pure functions.

use serde_json::Value;

/// Largest value a Postgres `serial` / `integer` id column can hold.
const MAX_ID: i64 = 2_147_483_647;

/// Parse a database id from a URL segment, query parameter or JSON value.
///
/// Returns a positive integer that fits a Postgres integer column, or `None`.
/// Only canonical forms are accepted: `12` or `"12"`, but not `"1.5"`, `"-3"`,
/// `""`, `"007"`, `"1e3"` or anything too large to be a real id.
pub fn parse_id_str(value: &str) -> Option<i32> {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 10 || bytes[0] == b'0' || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let id: i64 = value.parse().ok()?;
    (1..=MAX_ID).contains(&id).then_some(id as i32)
}

/// Same rules as [`parse_id_str`], for a JSON body field.
pub fn parse_id(value: Option<&Value>) -> Option<i32> {
    match value? {
        Value::String(s) => parse_id_str(s),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                (1..=MAX_ID).contains(&i).then_some(i as i32)
            } else {
                let f = n.as_f64()?;
                (f.fract() == 0.0 && f >= 1.0 && f <= MAX_ID as f64).then_some(f as i32)
            }
        }
        _ => None,
    }
}

const MAX_URL_LENGTH: usize = 2000;
/// About 190 KB of image once base64-decoded: enough for an avatar.
const MAX_DATA_URL_LENGTH: usize = 256_000;
const DATA_IMAGE_TYPES: [&str; 5] = ["png", "jpeg", "webp", "gif", "svg+xml"];

fn is_data_image(raw: &str) -> bool {
    let lower = raw.get(..32).unwrap_or(raw).to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("data:image/") else { return false };
    DATA_IMAGE_TYPES.iter().any(|kind| {
        rest.strip_prefix(kind).is_some_and(|after| after.starts_with(';') || after.starts_with(','))
    })
}

/// Validate an avatar value from user input. Returns the value to store, or
/// `None` (which renders the default generated emblem).
///
/// Allowed: `preset:<id>`, root-relative paths (`/avatars/a.png`), `https://`
/// URLs, and `data:image/` URLs for png, jpeg, webp, gif or svg+xml.
/// Not allowed: `http://` (mixed content, unencrypted remote fetches),
/// protocol-relative `//host`, and any other scheme. Over-long values are
/// rejected rather than truncated, because a truncated data URL is a broken
/// image. Only new input is validated; stored avatars are left alone.
pub fn sanitize_avatar(value: Option<&Value>) -> Option<String> {
    let raw = value?.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    if is_data_image(raw) {
        return (raw.len() <= MAX_DATA_URL_LENGTH).then(|| raw.to_string());
    }
    if raw.len() > MAX_URL_LENGTH {
        return None;
    }
    if raw.starts_with("preset:") || (raw.starts_with('/') && !raw.starts_with("//")) {
        return Some(raw.to_string());
    }
    if raw.starts_with("https://") {
        let parsed = url::Url::parse(raw).ok()?;
        return (parsed.scheme() == "https" && parsed.host().is_some()).then(|| raw.to_string());
    }
    None
}

/// Validate a model server base URL: it must parse and use http: or https:
/// (so no file:, javascript:, ftp: ...). Returns the trimmed URL.
pub fn sanitize_base_url(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.is_empty() || raw.len() > 300 {
        return None;
    }
    let parsed = url::Url::parse(raw).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ids() {
        assert_eq!(parse_id_str("12"), Some(12));
        assert_eq!(parse_id_str("2147483647"), Some(2_147_483_647));
        for bad in ["abc", "1.5", "-3", "", "007", "999999999999999999", "0", " 12", "12 ", "1e3", "0x10", "2147483648"] {
            assert_eq!(parse_id_str(bad), None, "{bad:?}");
        }
        assert_eq!(parse_id(Some(&json!(12))), Some(12));
        assert_eq!(parse_id(Some(&json!("12"))), Some(12));
        for bad in [json!(0), json!(-3), json!(1.5), json!(2147483648_i64), json!(null), json!(true), json!([12]), json!({"id": 12})] {
            assert_eq!(parse_id(Some(&bad)), None, "{bad}");
        }
        assert_eq!(parse_id(None), None);
    }

    #[test]
    fn avatars_accepted() {
        for ok in [
            "preset:orbit",
            "/avatars/a.png",
            "https://example.com/a.png",
            "data:image/png;base64,iVBORw0KGgo=",
            "data:image/jpeg;base64,/9j/4AAQ",
            "data:image/webp;base64,UklGRg==",
            "data:image/gif;base64,R0lGODlh",
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
            "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
        ] {
            assert_eq!(sanitize_avatar(Some(&json!(ok))).as_deref(), Some(ok), "{ok}");
        }
        assert_eq!(sanitize_avatar(Some(&json!("  https://example.com/a.png  "))).as_deref(), Some("https://example.com/a.png"));
    }

    #[test]
    fn avatars_rejected() {
        for bad in [
            "http://example.com/a.png",
            "//example.com/a.png",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "ftp://example.com/a.png",
            "data:text/html,<script>alert(1)</script>",
            "data:image/bmp;base64,Qk0=",
            "data:image/pngx;base64,AAAA",
            "example.com/a.png",
            "https://",
            "",
            "   ",
        ] {
            assert_eq!(sanitize_avatar(Some(&json!(bad))), None, "{bad}");
        }
        for bad in [json!(null), json!(42), json!({}), json!(["preset:orbit"])] {
            assert_eq!(sanitize_avatar(Some(&bad)), None);
        }
        assert_eq!(sanitize_avatar(None), None);
    }

    #[test]
    fn avatar_length_limits() {
        let fits = format!("data:image/png;base64,{}", "A".repeat(200_000));
        assert_eq!(sanitize_avatar(Some(&json!(fits))).as_deref(), Some(fits.as_str()));
        let too_big = format!("data:image/png;base64,{}", "A".repeat(300_000));
        assert_eq!(sanitize_avatar(Some(&json!(too_big))), None);
        let long_url = format!("https://example.com/{}", "a".repeat(2000));
        assert_eq!(sanitize_avatar(Some(&json!(long_url))), None);
    }

    #[test]
    fn base_urls() {
        assert_eq!(sanitize_base_url("http://127.0.0.1:11434/v1").as_deref(), Some("http://127.0.0.1:11434/v1"));
        assert_eq!(sanitize_base_url(" https://llm.example.com ").as_deref(), Some("https://llm.example.com"));
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "ftp://host/x", "127.0.0.1:11434", "not a url", ""] {
            assert_eq!(sanitize_base_url(bad), None, "{bad}");
        }
    }
}
