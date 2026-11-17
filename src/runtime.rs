//! Talking to the configured model: Ollama (`/api/chat`, NDJSON when
//! streaming) or any OpenAI-compatible server (`/v1/chat/completions`, SSE
//! when streaming). When the model cannot be used, the built-in engine answers
//! instead and a notice explains why.

use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::mpsc;

use crate::data::get_runtime_config;
use crate::models::{Bot, RuntimeConfig};
use crate::persona::{ChatTurn, build_system_prompt, generate_demo_reply};

pub const BUILT_IN_ENGINE: &str = "vesper-local";

#[derive(Debug)]
pub enum ModelError {
    /// Nothing arrived within the configured timeout.
    Timeout,
    /// Could not connect, or the HTTP exchange failed.
    Unreachable(String),
    /// The server answered with an error status or an unusable body.
    Rejected(String),
    Empty,
}

impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModelError::Timeout => write!(f, "timed out"),
            ModelError::Unreachable(why) | ModelError::Rejected(why) => write!(f, "{why}"),
            ModelError::Empty => write!(f, "The local model returned an empty response"),
        }
    }
}

/// The innermost cause of a reqwest error, e.g. "Connection refused (os error 111)".
fn describe(error: &reqwest::Error) -> String {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(inner) = source {
        message = inner.to_string();
        source = inner.source();
    }
    message
}

fn classify(error: reqwest::Error) -> ModelError {
    if error.is_timeout() { ModelError::Timeout } else { ModelError::Unreachable(describe(&error)) }
}

/// Explain why the configured model was not used, distinguishing "it took too
/// long" from "it could not be reached or returned an error".
pub fn fallback_notice(error: &ModelError, timeout_seconds: i32) -> String {
    match error {
        ModelError::Timeout => format!(
            "Your model timed out after {timeout_seconds}s (it may still be loading — you can raise the timeout in Runtime). Replied with the built-in engine."
        ),
        other => format!("Couldn't reach your model ({other}). Replied with the built-in engine."),
    }
}

fn normalize_base(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn openai_endpoint(base_url: &str) -> Result<String, ModelError> {
    let base = normalize_base(base_url);
    if base.is_empty() {
        return Err(ModelError::Rejected("Local server URL is empty".into()));
    }
    let lower = base.to_ascii_lowercase();
    Ok(if lower.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else if lower.ends_with("/chat/completions") {
        base
    } else {
        format!("{base}/v1/chat/completions")
    })
}

fn strip_v1(base: &str) -> &str {
    if base.to_ascii_lowercase().ends_with("/v1") { &base[..base.len() - 3] } else { base }
}

fn ollama_endpoint(base_url: &str) -> Result<String, ModelError> {
    let base = normalize_base(base_url);
    let base = strip_v1(&base);
    if base.is_empty() {
        return Err(ModelError::Rejected("Local server URL is empty".into()));
    }
    Ok(format!("{base}/api/chat"))
}

fn cap(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn model_messages(system: &str, history: &[ChatTurn], user_message: &str) -> Vec<Value> {
    let kept: Vec<&ChatTurn> = history.iter().filter(|t| !t.content.trim().is_empty()).collect();
    let start = kept.len().saturating_sub(12);
    let mut out = vec![json!({ "role": "system", "content": system })];
    for turn in &kept[start..] {
        let role = if turn.role == "assistant" { "assistant" } else { "user" };
        out.push(json!({ "role": role, "content": cap(&turn.content, 4000) }));
    }
    out.push(json!({ "role": "user", "content": cap(user_message, 4000) }));
    out
}

fn request(
    http: &reqwest::Client,
    config: &RuntimeConfig,
    system: &str,
    history: &[ChatTurn],
    user_message: &str,
    stream: bool,
) -> Result<reqwest::RequestBuilder, ModelError> {
    let messages = model_messages(system, history, user_message);
    let (url, body) = if config.provider == "ollama" {
        (
            ollama_endpoint(&config.base_url)?,
            json!({
                "model": config.model,
                "messages": messages,
                "stream": stream,
                // num_predict is Ollama's name for the reply token limit.
                "options": { "temperature": config.temperature, "num_predict": config.max_tokens },
            }),
        )
    } else {
        (
            openai_endpoint(&config.base_url)?,
            json!({
                "model": config.model,
                "messages": messages,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
                "stream": stream,
            }),
        )
    };
    let mut builder = http.post(url).json(&body);
    if !config.api_key.is_empty() {
        builder = builder.bearer_auth(&config.api_key);
    }
    Ok(builder)
}

async fn rejected(response: reqwest::Response) -> ModelError {
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    let detail: String = detail.chars().take(180).collect();
    let reason = status.canonical_reason().unwrap_or("");
    if detail.is_empty() {
        ModelError::Rejected(format!("{} {reason}", status.as_u16()))
    } else {
        ModelError::Rejected(format!("{} {reason} — {detail}", status.as_u16()))
    }
}

/// Pull the reply text out of a complete (non-streamed) response body.
fn reply_from_json(data: &Value) -> Option<String> {
    data.pointer("/choices/0/message/content")
        .or_else(|| data.pointer("/message/content"))
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn call_model(
    http: &reqwest::Client,
    config: &RuntimeConfig,
    system: &str,
    history: &[ChatTurn],
    user_message: &str,
) -> Result<String, ModelError> {
    let response = request(http, config, system, history, user_message, false)?
        .timeout(Duration::from_secs(config.timeout_seconds as u64))
        .send()
        .await
        .map_err(classify)?;
    if !response.status().is_success() {
        return Err(rejected(response).await);
    }
    let data: Value = response.json().await.map_err(classify)?;
    reply_from_json(&data).ok_or(ModelError::Empty)
}

pub struct Reply {
    pub content: String,
    pub engine: String,
    pub notice: Option<String>,
}

/// One complete reply, falling back to the built-in engine on any failure.
pub async fn generate_reply(
    pool: &PgPool,
    http: &reqwest::Client,
    bot: &Bot,
    history: &[ChatTurn],
    user_message: &str,
) -> sqlx::Result<Reply> {
    let runtime = get_runtime_config(pool).await?;
    let user_name = if runtime.user_name.is_empty() { "you".to_string() } else { runtime.user_name.clone() };
    if runtime.provider == "demo" {
        return Ok(Reply {
            content: generate_demo_reply(bot, history, user_message, &user_name),
            engine: BUILT_IN_ENGINE.into(),
            notice: None,
        });
    }
    let system = build_system_prompt(bot, &user_name);
    Ok(match call_model(http, &runtime, &system, history, user_message).await {
        Ok(content) => Reply { content, engine: format!("{}:{}", runtime.provider, runtime.model), notice: None },
        Err(error) => Reply {
            content: generate_demo_reply(bot, history, user_message, &user_name),
            engine: BUILT_IN_ENGINE.into(),
            notice: Some(fallback_notice(&error, runtime.timeout_seconds)),
        },
    })
}

/// Result of a streamed reply. `stopped` means the listener went away
/// (Stop button, closed tab) and `text` holds whatever had arrived.
pub struct StreamOutcome {
    pub text: String,
    pub engine: String,
    pub notice: Option<String>,
    pub stopped: bool,
}

/// Why reading the upstream stream ended early.
enum StreamStop {
    Listener,
    Failed(ModelError),
}

/// Read the model's streamed answer, forwarding each piece of text to `deltas`.
/// The timeout is an idle timer: it only fires if the model goes silent.
async fn read_stream(
    http: &reqwest::Client,
    config: &RuntimeConfig,
    system: &str,
    history: &[ChatTurn],
    user_message: &str,
    deltas: &mpsc::Sender<String>,
    text: &mut String,
) -> Result<(), StreamStop> {
    let idle = Duration::from_secs(config.timeout_seconds as u64);
    let send = request(http, config, system, history, user_message, true).map_err(StreamStop::Failed)?.send();
    let response = tokio::select! {
        result = tokio::time::timeout(idle, send) => match result {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => return Err(StreamStop::Failed(classify(error))),
            Err(_) => return Err(StreamStop::Failed(ModelError::Timeout)),
        },
        _ = deltas.closed() => return Err(StreamStop::Listener),
    };
    if !response.status().is_success() {
        return Err(StreamStop::Failed(rejected(response).await));
    }

    let emit = |piece: &str, text: &mut String| -> Result<(), StreamStop> {
        if piece.is_empty() {
            return Ok(());
        }
        text.push_str(piece);
        deltas.try_send(piece.to_string()).or_else(|error| match error {
            mpsc::error::TrySendError::Closed(_) => Err(StreamStop::Listener),
            // The channel is large; if it is ever full the text is still
            // recorded and the browser catches up from the final reply.
            mpsc::error::TrySendError::Full(_) => Ok(()),
        })
    };

    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let is_ollama = config.provider == "ollama";

    // Some OpenAI-compatible servers ignore stream:true and send ordinary JSON.
    if !is_ollama && !content_type.contains("text/event-stream") {
        let body = tokio::time::timeout(idle, response.json::<Value>())
            .await
            .map_err(|_| StreamStop::Failed(ModelError::Timeout))?
            .map_err(|e| StreamStop::Failed(classify(e)))?;
        if let Some(reply) = reply_from_json(&body) {
            emit(&reply, text)?;
        }
        return Ok(());
    }

    let mut bytes = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut raw_lines = String::new();
    let mut parsed_any = false;
    loop {
        let chunk = tokio::select! {
            next = tokio::time::timeout(idle, bytes.next()) => match next {
                Ok(Some(Ok(chunk))) => chunk,
                Ok(Some(Err(error))) => return Err(StreamStop::Failed(ModelError::Unreachable(describe(&error)))),
                Ok(None) => break,
                Err(_) => return Err(StreamStop::Failed(ModelError::Timeout)),
            },
            _ = deltas.closed() => return Err(StreamStop::Listener),
        };
        buffer.extend_from_slice(&chunk);
        while let Some(newline) = buffer.iter().position(|b| *b == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=newline).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim_end_matches(['\n', '\r']).to_string();
            if is_ollama {
                if line.trim().is_empty() {
                    continue;
                }
                raw_lines.push_str(&line);
                let Ok(data) = serde_json::from_str::<Value>(&line) else { continue };
                parsed_any = true;
                if let Some(error) = data.get("error").and_then(Value::as_str) {
                    return Err(StreamStop::Failed(ModelError::Rejected(error.to_string())));
                }
                if let Some(piece) = data.pointer("/message/content").and_then(Value::as_str) {
                    emit(piece, text)?;
                }
                if data.get("done").and_then(Value::as_bool) == Some(true) {
                    return Ok(());
                }
            } else {
                let Some(payload) = line.strip_prefix("data:") else { continue };
                let payload = payload.trim();
                if payload == "[DONE]" {
                    return Ok(());
                }
                if let Ok(data) = serde_json::from_str::<Value>(payload)
                    && let Some(piece) = data.pointer("/choices/0/delta/content").and_then(Value::as_str)
                {
                    emit(piece, text)?;
                }
            }
        }
    }
    // A trailing line without a newline, or a pretty-printed single JSON body
    // from a server that ignored stream:true.
    if is_ollama {
        let rest = String::from_utf8_lossy(&buffer).to_string();
        raw_lines.push_str(&rest);
        let candidate = if parsed_any { rest } else { raw_lines };
        if let Ok(data) = serde_json::from_str::<Value>(candidate.trim()) {
            if let Some(error) = data.get("error").and_then(Value::as_str) {
                return Err(StreamStop::Failed(ModelError::Rejected(error.to_string())));
            }
            if let Some(piece) = data.pointer("/message/content").and_then(Value::as_str) {
                emit(piece, text)?;
            }
        }
    }
    Ok(())
}

/// Streaming version of [`generate_reply`]. Text pieces go to `deltas` as the
/// model produces them; the returned outcome describes how it ended.
///
/// - Built-in engine: the whole reply arrives as a single piece.
/// - Model fails before producing anything: built-in reply plus a notice.
/// - Model fails part-way: keeps the partial text and says why it stopped.
/// - The receiver of `deltas` is dropped (client disconnected): reading stops,
///   upstream is closed, and `stopped` is true so the caller can save the part.
pub async fn stream_reply(
    pool: &PgPool,
    http: &reqwest::Client,
    bot: &Bot,
    history: &[ChatTurn],
    user_message: &str,
    deltas: mpsc::Sender<String>,
) -> sqlx::Result<StreamOutcome> {
    let runtime = get_runtime_config(pool).await?;
    let user_name = if runtime.user_name.is_empty() { "you".to_string() } else { runtime.user_name.clone() };
    let built_in = || generate_demo_reply(bot, history, user_message, &user_name);

    if runtime.provider == "demo" {
        let text = built_in();
        let stopped = deltas.send(text.clone()).await.is_err();
        return Ok(StreamOutcome { text, engine: BUILT_IN_ENGINE.into(), notice: None, stopped });
    }

    let engine = format!("{}:{}", runtime.provider, runtime.model);
    let system = build_system_prompt(bot, &user_name);
    let mut text = String::new();
    let result = read_stream(http, &runtime, &system, history, user_message, &deltas, &mut text).await;
    let produced = !text.trim().is_empty();
    Ok(match result {
        Ok(()) if produced => StreamOutcome { text, engine, notice: None, stopped: false },
        Err(StreamStop::Listener) => StreamOutcome { text, engine, notice: None, stopped: true },
        Err(StreamStop::Failed(error)) if produced => {
            let why = match error {
                ModelError::Timeout => format!("the model went silent for {}s", runtime.timeout_seconds),
                other => other.to_string(),
            };
            StreamOutcome {
                text,
                engine,
                notice: Some(format!("The reply was cut short ({why}). The part that arrived was kept.")),
                stopped: false,
            }
        }
        outcome => {
            let error = match outcome {
                Err(StreamStop::Failed(error)) => error,
                _ => ModelError::Empty,
            };
            let fallback = built_in();
            let stopped = deltas.send(fallback.clone()).await.is_err();
            StreamOutcome {
                text: fallback,
                engine: BUILT_IN_ENGINE.into(),
                notice: Some(fallback_notice(&error, runtime.timeout_seconds)),
                stopped,
            }
        }
    })
}

#[derive(serde::Serialize)]
pub struct Probe {
    pub ok: bool,
    pub detail: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<String>,
}

/// Check that a model server answers, and list its models.
pub async fn probe_runtime(http: &reqwest::Client, provider: &str, base_url: &str, api_key: &str) -> Probe {
    let fail = |detail: String| Probe { ok: false, detail, models: Vec::new() };
    if provider == "demo" {
        return Probe { ok: true, detail: "Built-in engine is always available. No server needed.".into(), models: Vec::new() };
    }
    let base = normalize_base(base_url);
    if base.is_empty() {
        return fail("Add a local server URL first.".into());
    }
    let url = if provider == "ollama" {
        format!("{}/api/tags", strip_v1(&base))
    } else {
        match openai_endpoint(&base) {
            Ok(endpoint) => format!("{}/models", endpoint.trim_end_matches("/chat/completions")),
            Err(error) => return fail(error.to_string()),
        }
    };
    let mut builder = http.get(url).timeout(Duration::from_secs(8));
    if !api_key.is_empty() {
        builder = builder.bearer_auth(api_key);
    }
    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => return fail(format!("Couldn't connect: {}", describe(&error))),
    };
    if !response.status().is_success() {
        let status = response.status();
        return fail(format!("Server responded {} {}.", status.as_u16(), status.canonical_reason().unwrap_or("")));
    }
    let data: Value = response.json().await.unwrap_or(Value::Null);
    let names = |key: &str, field: &str| -> Vec<String> {
        data.get(key)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(|m| m.get(field).and_then(Value::as_str).map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let mut models = names("data", "id");
    if models.is_empty() {
        models = names("models", "name");
    }
    let detail = if models.is_empty() {
        "Connected to your local server.".to_string()
    } else {
        format!(
            "Connected. {} model{} available: {}",
            models.len(),
            if models.len() == 1 { "" } else { "s" },
            models.iter().take(5).cloned().collect::<Vec<_>>().join(", ")
        )
    };
    Probe { ok: true, detail, models }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints() {
        assert_eq!(openai_endpoint("http://h:1/v1/").unwrap(), "http://h:1/v1/chat/completions");
        assert_eq!(openai_endpoint("http://h:1").unwrap(), "http://h:1/v1/chat/completions");
        assert_eq!(openai_endpoint("http://h:1/v1/chat/completions").unwrap(), "http://h:1/v1/chat/completions");
        assert_eq!(ollama_endpoint("http://h:11434/v1").unwrap(), "http://h:11434/api/chat");
        assert!(ollama_endpoint("  ").is_err());
    }

    #[test]
    fn notices() {
        assert!(fallback_notice(&ModelError::Timeout, 10).starts_with("Your model timed out after 10s"));
        assert_eq!(
            fallback_notice(&ModelError::Unreachable("Connection refused".into()), 10),
            "Couldn't reach your model (Connection refused). Replied with the built-in engine."
        );
    }

    #[test]
    fn history_is_trimmed() {
        let history: Vec<ChatTurn> =
            (0..20).map(|i| ChatTurn { role: "user".into(), content: format!("m{i}") }).collect();
        let messages = model_messages("sys", &history, "now");
        assert_eq!(messages.len(), 14);
        assert_eq!(messages[1]["content"], "m8");
        assert_eq!(messages[13]["content"], "now");
    }
}
