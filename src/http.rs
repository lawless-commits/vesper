//! Shared HTTP plumbing: app state, JSON errors, body parsing, the
//! same-origin check and optional password protection.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use base64::Engine;
use serde_json::{Map, Value, json};
use sqlx::PgPool;
use subtle::ConstantTimeEq;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub http: reqwest::Client,
    pub settings: std::sync::Arc<Settings>,
}

/// Values read from the environment at startup.
#[derive(Debug, Clone, Default)]
pub struct Settings {
    pub autopilot_token: Option<String>,
    pub password: Option<String>,
}

impl Settings {
    pub fn from_env() -> Self {
        let read = |key: &str| std::env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        Settings { autopilot_token: read("AUTOPILOT_TOKEN"), password: read("VESPER_PASSWORD") }
    }
}

/// An API error rendered as `{ "error": "..." }`. Database failures become a
/// 500 with a generic message; the detail goes to the log, not the client.
#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    NotFound(String),
    Unauthorized(String),
    Internal(String),
}

pub type ApiResult<T = Response> = Result<T, ApiError>;

pub fn bad_request(message: impl Into<String>) -> ApiError {
    ApiError::BadRequest(message.into())
}

pub fn not_found(message: impl Into<String>) -> ApiError {
    ApiError::NotFound(message.into())
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        tracing::error!(%error, "database error");
        ApiError::Internal("Something went wrong on the server.".into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            ApiError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m),
            ApiError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

/// A parsed JSON object body with JavaScript-like field coercions, so the API
/// accepts the same loose input the original TypeScript routes did.
pub struct JsonBody(pub Map<String, Value>);

impl JsonBody {
    /// Parse a body that must be a JSON object; anything else is a 400.
    pub fn parse(bytes: &Bytes) -> Result<Self, ApiError> {
        match serde_json::from_slice::<Value>(bytes) {
            Ok(Value::Object(map)) => Ok(JsonBody(map)),
            _ => Err(bad_request("Invalid JSON body")),
        }
    }

    /// Parse a body that may be empty or invalid (treated as `{}`).
    pub fn parse_lenient(bytes: &Bytes) -> Self {
        Self::parse(bytes).unwrap_or(JsonBody(Map::new()))
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key).filter(|v| !v.is_null())
    }

    pub fn has(&self, key: &str) -> bool {
        self.0.contains_key(key)
    }

    /// `String(body[key] ?? "")`.
    pub fn string(&self, key: &str) -> String {
        match self.get(key) {
            None => String::new(),
            Some(Value::String(s)) => s.clone(),
            Some(Value::Bool(b)) => b.to_string(),
            Some(Value::Number(n)) => n.to_string(),
            Some(other) => other.to_string(),
        }
    }

    /// The field if it is a string, else None.
    pub fn str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Value::as_str)
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        self.get(key).and_then(Value::as_bool)
    }

    /// `Number(body[key])` when present: Some(Ok(n)) for numbers and numeric
    /// strings, Some(Err(())) for anything else, None when missing.
    pub fn number(&self, key: &str) -> Option<Result<f64, ()>> {
        let value = self.0.get(key)?;
        Some(match value {
            Value::Number(n) => n.as_f64().ok_or(()),
            Value::String(s) if s.trim().is_empty() => Ok(0.0),
            Value::String(s) => s.trim().parse::<f64>().map_err(|_| ()),
            Value::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
            Value::Null => Ok(0.0),
            _ => Err(()),
        }
        .and_then(|n| if n.is_finite() { Ok(n) } else { Err(()) }))
    }

    /// Up to `limit` non-empty trimmed strings from an array field.
    pub fn string_list(&self, key: &str, limit: usize) -> Option<Vec<String>> {
        let items = self.get(key)?.as_array()?;
        Some(
            items
                .iter()
                .map(|item| match item {
                    Value::String(s) => s.trim().to_string(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                })
                .filter(|s| !s.is_empty())
                .take(limit)
                .collect(),
        )
    }
}

pub fn take_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// True when the request was made by a page served from this same origin
/// (the app's own UI), as opposed to curl, cron or another site.
///
/// Browsers set `Sec-Fetch-Site` themselves and page scripts cannot override
/// it, so it is trusted when present. Older browsers fall back to comparing
/// the `Origin` host with the `Host` header. A non-browser client can forge
/// these headers: this stops other websites, not a determined local caller.
pub fn is_same_origin(headers: &HeaderMap) -> bool {
    let get = |name: &str| headers.get(name).and_then(|v| v.to_str().ok());
    if let Some(site) = get("sec-fetch-site") {
        return site == "same-origin";
    }
    let (Some(origin), Some(host)) = (get("origin"), get("host")) else { return false };
    url::Url::parse(origin)
        .ok()
        .and_then(|url| {
            let origin_host = match (url.host_str(), url.port()) {
                (Some(h), Some(p)) => format!("{h}:{p}"),
                (Some(h), None) => h.to_string(),
                _ => return None,
            };
            Some(origin_host.eq_ignore_ascii_case(host))
        })
        .unwrap_or(false)
}

/// Constant-time comparison of a caller-supplied secret with the expected one.
pub fn secret_matches(provided: Option<&str>, expected: &str) -> bool {
    match provided {
        Some(p) if !p.is_empty() && !expected.is_empty() => {
            let (a, b) = (p.as_bytes(), expected.as_bytes());
            a.len() == b.len() && bool::from(a.ct_eq(b))
        }
        _ => false,
    }
}

/// Optional HTTP Basic auth for the whole app. Off unless VESPER_PASSWORD is
/// set; then every page and API route except /api/health requires it. The
/// username is ignored; only the password is checked.
pub async fn require_password(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let Some(password) = state.settings.password.as_deref() else { return next.run(request).await };
    if request.uri().path() == "/api/health" {
        return next.run(request).await;
    }
    let provided = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.get(..6).filter(|p| p.eq_ignore_ascii_case("basic ")).map(|_| v[6..].trim()))
        .and_then(|encoded| base64::engine::general_purpose::STANDARD.decode(encoded).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        // "username:password" — the password may itself contain colons.
        .and_then(|decoded| decoded.split_once(':').map(|(_, p)| p.to_string()));
    if secret_matches(provided.as_deref(), password) {
        return next.run(request).await;
    }
    let mut response = (StatusCode::UNAUTHORIZED, "Authentication required.").into_response();
    response
        .headers_mut()
        .insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Basic realm=\"Vesper\", charset=\"UTF-8\""));
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(*k, HeaderValue::from_static(v));
        }
        map
    }

    #[test]
    fn same_origin() {
        assert!(is_same_origin(&headers(&[("sec-fetch-site", "same-origin")])));
        for site in ["cross-site", "same-site", "none"] {
            let h = headers(&[("sec-fetch-site", site), ("origin", "http://localhost:3000"), ("host", "localhost:3000")]);
            assert!(!is_same_origin(&h), "{site}");
        }
        assert!(is_same_origin(&headers(&[("origin", "http://localhost:3000"), ("host", "localhost:3000")])));
        assert!(is_same_origin(&headers(&[("origin", "http://LOCALHOST:3000"), ("host", "localhost:3000")])));
        assert!(!is_same_origin(&headers(&[("origin", "http://evil.test"), ("host", "localhost:3000")])));
        assert!(!is_same_origin(&headers(&[("origin", "http://localhost:4000"), ("host", "localhost:3000")])));
        assert!(!is_same_origin(&headers(&[])));
        assert!(!is_same_origin(&headers(&[("origin", "null"), ("host", "localhost:3000")])));
    }

    #[test]
    fn secrets() {
        assert!(secret_matches(Some("secret"), "secret"));
        assert!(!secret_matches(Some("secreT"), "secret"));
        assert!(!secret_matches(Some("secret1"), "secret"));
        assert!(!secret_matches(Some(""), "secret"));
        assert!(!secret_matches(None, "secret"));
        assert!(!secret_matches(Some("secret"), ""));
    }

    #[test]
    fn body_coercions() {
        let body = JsonBody::parse(&Bytes::from_static(br#"{"a":"x","n":"12","b":true,"z":null,"list":[" a ","",3]}"#)).unwrap();
        assert_eq!(body.string("a"), "x");
        assert_eq!(body.string("missing"), "");
        assert_eq!(body.string("z"), "");
        assert_eq!(body.number("n"), Some(Ok(12.0)));
        assert_eq!(body.number("a"), Some(Err(())));
        assert_eq!(body.number("missing"), None);
        assert_eq!(body.bool("b"), Some(true));
        assert_eq!(body.string_list("list", 5), Some(vec!["a".to_string(), "3".to_string()]));
        assert!(JsonBody::parse(&Bytes::from_static(b"[1]")).is_err());
        assert!(JsonBody::parse(&Bytes::from_static(b"nope")).is_err());
    }
}
