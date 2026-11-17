//! JSON API under /api. Errors are `{ "error": "..." }` with 400 for bad
//! input and 404 for missing rows; user input never causes a 500.

use std::convert::Infallible;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use sqlx::types::Json as DbJson;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::autopilot::{self, AutomationPatch, Decision};
use crate::data;
use crate::http::{ApiError, ApiResult, AppState, JsonBody, bad_request, is_same_origin, not_found, secret_matches, take_chars};
use crate::models::{Bot, BotRow, ConversationRow, MAX_TOKENS_LIMIT, Message, TIMEOUT_LIMIT};
use crate::persona::{ChatTurn, DraftInput, draft_persona, suggest_starters};
use crate::runtime::{generate_reply, probe_runtime, stream_reply};
use crate::timezone::is_valid_time_zone;
use crate::util::{handleify, is_hex_color, squash_whitespace, truncate};
use crate::validate::{parse_id, parse_id_str, sanitize_avatar, sanitize_base_url};

fn path_id(raw: &str, message: &str) -> Result<i32, ApiError> {
    parse_id_str(raw).ok_or_else(|| bad_request(message))
}

pub async fn health(State(state): State<AppState>) -> Response {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "ok": false }))).into_response(),
    }
}

// ----- Bots -----

fn clamp_number(body: &JsonBody, key: &str, fallback: f64, min: f64, max: f64) -> f64 {
    match body.number(key) {
        Some(Ok(n)) => n.clamp(min, max),
        _ => fallback,
    }
}

fn clean_tags(body: &JsonBody) -> Option<Vec<String>> {
    body.string_list("tags", 6).map(|tags| tags.into_iter().map(|t| take_chars(&t.to_lowercase(), 24)).collect())
}

pub async fn list_bots(State(state): State<AppState>) -> ApiResult {
    data::ensure_seeded(&state.pool).await?;
    let rows: Vec<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots ORDER BY featured DESC, id ASC"))
        .fetch_all(&state.pool)
        .await?;
    let bots: Vec<Bot> = rows.into_iter().map(Bot::from).collect();
    Ok(Json(json!({ "bots": bots })).into_response())
}

pub async fn create_bot(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    data::ensure_seeded(&state.pool).await?;
    let body = JsonBody::parse(&bytes)?;
    let name = take_chars(body.string("name").trim(), 48);
    if name.is_empty() {
        return Err(bad_request("Every bot needs a name."));
    }
    let tags = clean_tags(&body).unwrap_or_default();
    let warmth = clamp_number(&body, "warmth", 60.0, 0.0, 100.0).round() as i32;
    let chaos = clamp_number(&body, "chaos", 35.0, 0.0, 100.0).round() as i32;
    let wit = clamp_number(&body, "wit", 65.0, 0.0, 100.0).round() as i32;
    let tagline = take_chars(body.string("tagline").trim(), 120);

    let requested = body.string("handle");
    let base_handle = handleify(if requested.is_empty() { &name } else { &requested });
    let taken: Vec<String> = sqlx::query_scalar("SELECT handle FROM bots").fetch_all(&state.pool).await?;
    let mut handle = base_handle.clone();
    let mut counter = 2;
    while taken.contains(&handle) {
        handle = format!("{base_handle}-{counter}");
        counter += 1;
    }

    let starters = body.string_list("starters", 4).unwrap_or_default();
    let starters = if starters.is_empty() { suggest_starters(&name, &tags) } else { starters };
    let greeting = take_chars(body.string("greeting").trim(), 400);
    let greeting = if greeting.is_empty() {
        format!("Hi, I'm {name}. {}", if tagline.is_empty() { "Tell me what's on your mind." } else { &tagline })
    } else {
        greeting
    };
    let persona = take_chars(body.string("persona").trim(), 4000);
    let persona = if persona.is_empty() {
        draft_persona(&DraftInput { name: &name, tagline: &tagline, tags: &tags, warmth, chaos, wit })
    } else {
        persona
    };
    let seed = body.string("avatarSeed");
    let accent = body.string("accent");
    let model = take_chars(&body.string("model"), 80);

    let row: BotRow = sqlx::query_as(concat!("INSERT INTO bots (name, handle, tagline, bio, persona, greeting, starters, avatar_url, avatar_seed, accent, tags, warmth, chaos, wit, model, temperature, visibility, creator, featured)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, false)
         RETURNING ", crate::bot_columns!()))
    .bind(&name)
    .bind(&handle)
    .bind(&tagline)
    .bind(take_chars(body.string("bio").trim(), 1200))
    .bind(&persona)
    .bind(&greeting)
    .bind(DbJson(&starters))
    .bind(sanitize_avatar(body.get("avatarUrl")))
    .bind(if seed.is_empty() { handle.clone() } else { take_chars(&seed, 60) })
    .bind(if is_hex_color(&accent) { accent } else { "#c9f954".to_string() })
    .bind(DbJson(&tags))
    .bind(warmth)
    .bind(chaos)
    .bind(wit)
    .bind(if model.is_empty() { "local".to_string() } else { model })
    .bind(clamp_number(&body, "temperature", 0.8, 0.0, 1.5) as f32)
    .bind(if body.str("visibility") == Some("private") { "private" } else { "public" })
    .bind(take_chars(&{ let c = body.string("creator"); if c.is_empty() { "you".to_string() } else { c } }, 40))
    .fetch_one(&state.pool)
    .await?;
    Ok((StatusCode::CREATED, Json(json!({ "bot": Bot::from(row) }))).into_response())
}

pub async fn update_bot(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse(&bytes)?;
    let id = parse_id(body.get("id")).ok_or_else(|| bad_request("Missing bot id"))?;
    let current: Option<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.pool)
        .await?;
    let current = Bot::from(current.ok_or_else(|| not_found("Bot not found"))?);

    let text = |key: &str, max: usize, fallback: &str| -> String {
        if body.get(key).is_some() { take_chars(&body.string(key), max) } else { fallback.to_string() }
    };
    let name = match body.get("name") {
        Some(_) => {
            let n = take_chars(body.string("name").trim(), 48);
            if n.is_empty() { current.name.clone() } else { n }
        }
        None => current.name.clone(),
    };
    let dial = |key: &str, fallback: i32| clamp_number(&body, key, fallback as f64, 0.0, 100.0).round() as i32;
    let accent = body.string("accent");
    let visibility = match body.str("visibility") {
        Some("private") => "private".to_string(),
        Some("public") => "public".to_string(),
        _ => current.visibility.clone(),
    };
    let avatar_url = if body.has("avatarUrl") { sanitize_avatar(body.get("avatarUrl")) } else { current.avatar_url.clone() };

    let row: BotRow = sqlx::query_as(concat!("UPDATE bots SET name = $2, tagline = $3, bio = $4, persona = $5, greeting = $6, starters = $7, avatar_url = $8,
             avatar_seed = $9, accent = $10, tags = $11, warmth = $12, chaos = $13, wit = $14, model = $15,
             temperature = $16, visibility = $17, updated_at = now()
         WHERE id = $1 RETURNING ", crate::bot_columns!()))
    .bind(id)
    .bind(&name)
    .bind(text("tagline", 120, &current.tagline))
    .bind(text("bio", 1200, &current.bio))
    .bind(text("persona", 4000, &current.persona))
    .bind(text("greeting", 400, &current.greeting))
    .bind(DbJson(body.string_list("starters", 4).unwrap_or_else(|| current.starters.clone())))
    .bind(avatar_url)
    .bind(text("avatarSeed", 60, &current.avatar_seed))
    .bind(if is_hex_color(&accent) { accent } else { current.accent.clone() })
    .bind(DbJson(clean_tags(&body).unwrap_or_else(|| current.tags.clone())))
    .bind(dial("warmth", current.warmth))
    .bind(dial("chaos", current.chaos))
    .bind(dial("wit", current.wit))
    .bind(text("model", 80, &current.model))
    .bind(clamp_number(&body, "temperature", current.temperature as f64, 0.0, 1.5) as f32)
    .bind(visibility)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(json!({ "bot": Bot::from(row) })).into_response())
}

pub async fn get_bot(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let id = path_id(&id, "Bad id")?;
    let bot = data::get_bot_by_id(&state.pool, id).await?.ok_or_else(|| not_found("Bot not found"))?;
    Ok(Json(json!({ "bot": bot })).into_response())
}

pub async fn delete_bot(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let id = path_id(&id, "Bad id")?;
    let deleted = sqlx::query("DELETE FROM bots WHERE id = $1").bind(id).execute(&state.pool).await?;
    if deleted.rows_affected() == 0 {
        return Err(not_found("Bot not found"));
    }
    Ok(Json(json!({ "ok": true })).into_response())
}

/// Draft a persona and starters from the studio dials (the studio's
/// "Draft from dials" button).
pub async fn draft(bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse(&bytes)?;
    let name = body.string("name");
    let tagline = body.string("tagline");
    let tags = clean_tags(&body).unwrap_or_default();
    let dial = |key: &str, fallback: f64| clamp_number(&body, key, fallback, 0.0, 100.0).round() as i32;
    let input = DraftInput { name: &name, tagline: &tagline, tags: &tags, warmth: dial("warmth", 65.0), chaos: dial("chaos", 40.0), wit: dial("wit", 70.0) };
    let display_name = if name.trim().is_empty() { "this bot" } else { name.trim() };
    Ok(Json(json!({ "persona": draft_persona(&input), "starters": suggest_starters(display_name, &tags) })).into_response())
}

// ----- Conversations -----

#[derive(serde::Deserialize)]
pub struct ConversationQuery {
    #[serde(rename = "botId")]
    bot_id: Option<String>,
}

pub async fn list_conversations(State(state): State<AppState>, Query(query): Query<ConversationQuery>) -> ApiResult {
    let bot_id = match query.bot_id {
        None => None,
        Some(raw) => Some(parse_id_str(&raw).ok_or_else(|| bad_request("Bad botId"))?),
    };
    let conversations = data::list_conversations(&state.pool, bot_id).await?;
    Ok(Json(json!({ "conversations": conversations })).into_response())
}

pub async fn create_conversation(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse(&bytes)?;
    let bot_id = parse_id(body.get("botId")).ok_or_else(|| bad_request("botId is required"))?;
    let bot = data::get_bot_by_id(&state.pool, bot_id).await?.ok_or_else(|| not_found("Bot not found"))?;

    if body.bool("reuseEmpty") == Some(true) {
        // This bot's oldest thread with at most one message (nothing, or just the greeting).
        let reusable: Option<ConversationRow> = sqlx::query_as(
            "SELECT c.id, c.bot_id, c.title, c.created_at, c.updated_at
             FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE c.bot_id = $1 GROUP BY c.id HAVING count(m.id) <= 1 ORDER BY c.id LIMIT 1",
        )
        .bind(bot_id)
        .fetch_optional(&state.pool)
        .await?;
        if let Some(conversation) = reusable {
            return Ok(Json(json!({ "conversation": conversation, "created": false })).into_response());
        }
    }

    let mut tx = state.pool.begin().await?;
    let conversation: ConversationRow = sqlx::query_as(
        "INSERT INTO conversations (bot_id, title) VALUES ($1, $2) RETURNING id, bot_id, title, created_at, updated_at",
    )
    .bind(bot_id)
    .bind(format!("Chat with {}", bot.name))
    .fetch_one(&mut *tx)
    .await?;
    if !bot.greeting.is_empty() {
        sqlx::query("INSERT INTO messages (conversation_id, role, content, engine) VALUES ($1, 'assistant', $2, 'vesper-local')")
            .bind(conversation.id)
            .bind(&bot.greeting)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({ "conversation": conversation, "created": true }))).into_response())
}

pub async fn get_conversation(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let id = path_id(&id, "Bad id")?;
    let (conversation, messages) =
        data::get_conversation(&state.pool, id).await?.ok_or_else(|| not_found("Conversation not found"))?;
    Ok(Json(json!({ "conversation": conversation, "messages": messages })).into_response())
}

pub async fn rename_conversation(State(state): State<AppState>, Path(id): Path<String>, bytes: Bytes) -> ApiResult {
    let id = path_id(&id, "Bad id")?;
    let body = JsonBody::parse(&bytes)?;
    let title = take_chars(body.string("title").trim(), 120);
    if title.is_empty() {
        return Err(bad_request("Title is required"));
    }
    let updated: Option<ConversationRow> = sqlx::query_as(
        "UPDATE conversations SET title = $2 WHERE id = $1 RETURNING id, bot_id, title, created_at, updated_at",
    )
    .bind(id)
    .bind(title)
    .fetch_optional(&state.pool)
    .await?;
    let conversation = updated.ok_or_else(|| not_found("Conversation not found"))?;
    Ok(Json(json!({ "conversation": conversation })).into_response())
}

pub async fn delete_conversation(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let id = path_id(&id, "Bad id")?;
    sqlx::query("DELETE FROM conversations WHERE id = $1").bind(id).execute(&state.pool).await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

// ----- Chat -----

/// Write the reply and the conversation update together, or neither.
async fn save_reply(
    state: &AppState,
    conversation_id: i32,
    content: &str,
    engine: &str,
    new_title: Option<&str>,
) -> sqlx::Result<Message> {
    let mut tx = state.pool.begin().await?;
    let reply: Message = sqlx::query_as(
        "INSERT INTO messages (conversation_id, role, content, engine) VALUES ($1, 'assistant', $2, $3)
         RETURNING id, role, content, engine, created_at",
    )
    .bind(conversation_id)
    .bind(content)
    .bind(engine)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE conversations SET updated_at = now(), title = coalesce($2, title) WHERE id = $1")
        .bind(conversation_id)
        .bind(new_title)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(reply)
}

fn sse_event(name: &str, data: Value) -> Event {
    Event::default().event(name).data(data.to_string())
}

/// One user turn → one in-character reply.
///
/// Body: `{ conversationId, content, stream? }`
///
/// - Default: one JSON response `{ userMessage, reply, engine, notice }`.
/// - `stream: true`: a text/event-stream with, in order: `user { userMessage }`,
///   zero or more `delta { text }`, then `done { reply, engine, notice }` or
///   `error { error, userMessageId }`.
///
/// The user message is saved first. The assistant message is written once,
/// when generation ends, in the same transaction as the conversation update.
/// If the client disconnects mid-stream (Stop button), the text that had
/// arrived is saved as the reply. After a failure the error carries
/// `userMessageId` so the client reloads instead of resending.
pub async fn chat(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    data::ensure_seeded(&state.pool).await?;
    let body = JsonBody::parse(&bytes)?;
    let conversation_id = parse_id(body.get("conversationId")).ok_or_else(|| bad_request("conversationId is required"))?;
    let content = take_chars(body.string("content").trim(), 4000);
    if content.is_empty() {
        return Err(bad_request("Message is empty"));
    }
    let row: Option<ConversationRow> =
        sqlx::query_as("SELECT id, bot_id, title, created_at, updated_at FROM conversations WHERE id = $1")
            .bind(conversation_id)
            .fetch_optional(&state.pool)
            .await?;
    let row = row.ok_or_else(|| not_found("Conversation not found"))?;
    let bot = data::get_bot_by_id(&state.pool, row.bot_id).await?.ok_or_else(|| not_found("Conversation not found"))?;

    let user_message: Message = sqlx::query_as(
        "INSERT INTO messages (conversation_id, role, content, engine) VALUES ($1, 'user', $2, 'user')
         RETURNING id, role, content, engine, created_at",
    )
    .bind(conversation_id)
    .bind(&content)
    .fetch_one(&state.pool)
    .await?;

    let history_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT role, content FROM messages WHERE conversation_id = $1 AND id <> $2 ORDER BY id ASC")
            .bind(conversation_id)
            .bind(user_message.id)
            .fetch_all(&state.pool)
            .await?;
    let human_turns = history_rows.iter().filter(|(role, _)| role == "user").count();
    let start = history_rows.len().saturating_sub(12);
    let history: Vec<ChatTurn> =
        history_rows[start..].iter().map(|(role, content)| ChatTurn { role: role.clone(), content: content.clone() }).collect();
    let new_title = (human_turns == 0 || row.title.starts_with("Chat with")).then(|| truncate(&squash_whitespace(&content), 64));

    let failure = json!({ "error": "The reply could not be completed. Your message was saved.", "userMessageId": user_message.id });

    if body.bool("stream") != Some(true) {
        let outcome = async {
            let reply = generate_reply(&state.pool, &state.http, &bot, &history, &content).await?;
            let saved = save_reply(&state, conversation_id, &reply.content, &reply.engine, new_title.as_deref()).await?;
            Ok::<_, sqlx::Error>((reply, saved))
        }
        .await;
        return Ok(match outcome {
            Ok((reply, saved)) => Json(json!({
                "userMessage": user_message,
                "reply": saved,
                "engine": reply.engine,
                "notice": reply.notice,
            }))
            .into_response(),
            Err(error) => {
                tracing::error!(%error, "chat: reply failed after the user message was saved");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(failure)).into_response()
            }
        });
    }

    let (events, receiver) = mpsc::channel::<Result<Event, Infallible>>(1024);
    // Generation runs in its own task so it can finish and save the partial
    // reply even after the browser disconnects.
    tokio::spawn(async move {
        let _ = events.send(Ok(sse_event("user", json!({ "userMessage": user_message })))).await;
        let (delta_tx, mut delta_rx) = mpsc::channel::<String>(1024);
        let forward = {
            let events = events.clone();
            async move {
                while let Some(text) = delta_rx.recv().await {
                    if events.send(Ok(sse_event("delta", json!({ "text": text })))).await.is_err() {
                        // Client gone: dropping the receiver tells stream_reply to stop.
                        break;
                    }
                }
            }
        };
        let generate = stream_reply(&state.pool, &state.http, &bot, &history, &content, delta_tx);
        let (outcome, ()) = tokio::join!(generate, forward);

        let result = match outcome {
            Ok(outcome) => {
                if outcome.stopped {
                    tracing::debug!(conversation_id, "chat: client stopped the reply; saving the part that arrived");
                }
                let text = outcome.text.trim().to_string();
                if text.is_empty() {
                    Err(None)
                } else {
                    save_reply(&state, conversation_id, &text, &outcome.engine, new_title.as_deref())
                        .await
                        .map(|saved| (saved, outcome))
                        .map_err(Some)
                }
            }
            Err(error) => Err(Some(error)),
        };
        match result {
            Ok((saved, outcome)) => {
                let _ = events
                    .send(Ok(sse_event("done", json!({ "reply": saved, "engine": outcome.engine, "notice": outcome.notice }))))
                    .await;
            }
            Err(error) => {
                if let Some(error) = error {
                    tracing::error!(%error, "chat: streamed reply failed after the user message was saved");
                }
                let _ = events.send(Ok(sse_event("error", failure))).await;
            }
        }
    });

    let mut response = Sse::new(ReceiverStream::new(receiver)).keep_alive(KeepAlive::default()).into_response();
    response.headers_mut().insert("cache-control", "no-cache, no-transform".parse().unwrap());
    response.headers_mut().insert("x-accel-buffering", "no".parse().unwrap());
    Ok(response)
}

// ----- Runtime -----

pub async fn get_runtime(State(state): State<AppState>) -> ApiResult {
    let runtime = data::get_runtime_config(&state.pool).await?.view();
    Ok(Json(json!({ "runtime": runtime })).into_response())
}

pub async fn update_runtime(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    data::ensure_seeded(&state.pool).await?;
    let body = JsonBody::parse(&bytes)?;
    let provider = body.string("provider");
    let provider = if ["demo", "ollama", "openai"].contains(&provider.as_str()) { provider } else { "demo".to_string() };
    let temperature = match body.number("temperature") {
        Some(Ok(n)) => n.clamp(0.0, 1.5),
        _ => 0.8,
    } as f32;

    // An empty URL falls back to the default; anything else must be http(s).
    let base_url_raw = body.string("baseUrl");
    let base_url = if base_url_raw.trim().is_empty() {
        "http://127.0.0.1:11434/v1".to_string()
    } else {
        sanitize_base_url(&base_url_raw)
            .ok_or_else(|| bad_request("Server URL must be a valid http:// or https:// address (300 characters at most)."))?
    };
    // Timezone is optional; when present it must be a real IANA name.
    let timezone = body.str("timezone").map(|t| t.trim().to_string());
    if let Some(zone) = &timezone
        && !is_valid_time_zone(zone)
    {
        return Err(bad_request(format!(
            "Unknown timezone \"{}\". Use an IANA name such as Africa/Johannesburg.",
            take_chars(zone, 64)
        )));
    }
    // The key is write-only: empty or missing keeps the stored key, and only
    // an explicit clearApiKey: true removes it.
    let new_key = body.str("apiKey").map(|k| take_chars(k.trim(), 300)).unwrap_or_default();
    let api_key: Option<String> = if body.bool("clearApiKey") == Some(true) {
        Some(String::new())
    } else if !new_key.is_empty() {
        Some(new_key)
    } else {
        None
    };
    let model = take_chars(body.string("model").trim(), 120);
    let user_name = take_chars(body.string("userName").trim(), 40);
    let timeout = body.has("timeoutSeconds").then(|| TIMEOUT_LIMIT.clamp_value(body.get("timeoutSeconds")));
    let max_tokens = body.has("maxTokens").then(|| MAX_TOKENS_LIMIT.clamp_value(body.get("maxTokens")));

    sqlx::query(
        "INSERT INTO runtime_settings (id, provider, base_url, model, api_key, temperature, user_name, timezone, timeout_seconds, max_tokens, updated_at)
         VALUES (1, $1, $2, $3, coalesce($4, ''), $5, $6, coalesce($7, 'UTC'), coalesce($8, 90), coalesce($9, 600), now())
         ON CONFLICT (id) DO UPDATE SET provider = $1, base_url = $2, model = $3,
             api_key = coalesce($4, runtime_settings.api_key), temperature = $5, user_name = $6,
             timezone = coalesce($7, runtime_settings.timezone),
             timeout_seconds = coalesce($8, runtime_settings.timeout_seconds),
             max_tokens = coalesce($9, runtime_settings.max_tokens), updated_at = now()",
    )
    .bind(&provider)
    .bind(&base_url)
    .bind(if model.is_empty() { "llama3.2".to_string() } else { model })
    .bind(api_key)
    .bind(temperature)
    .bind(if user_name.is_empty() { "You".to_string() } else { user_name })
    .bind(timezone)
    .bind(timeout)
    .bind(max_tokens)
    .execute(&state.pool)
    .await?;
    get_runtime(State(state)).await
}

pub async fn test_runtime(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse_lenient(&bytes);
    let provider = { let p = body.string("provider"); if p.is_empty() { "demo".to_string() } else { p } };
    let raw = body.string("baseUrl");
    let base_url = if raw.trim().is_empty() {
        String::new()
    } else {
        match sanitize_base_url(&raw) {
            Some(url) => url,
            // Same shape as a failed probe so the form shows it inline. Nothing is fetched.
            None => {
                return Ok((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "ok": false, "detail": "Server URL must be a valid http:// or https:// address." })),
                )
                    .into_response());
            }
        }
    };
    // The browser never holds the saved key, so fall back to it (or to
    // LLM_API_KEY) when the form did not supply a new one.
    let supplied = body.str("apiKey").map(str::trim).unwrap_or_default().to_string();
    let api_key = if !supplied.is_empty() {
        supplied
    } else if body.bool("clearApiKey") == Some(true) {
        String::new()
    } else {
        data::get_runtime_config(&state.pool).await?.api_key
    };
    let probe = probe_runtime(&state.http, &provider, &base_url, &api_key).await;
    Ok(Json(probe).into_response())
}

// ----- Autopilot -----

pub async fn automation_snapshot(State(state): State<AppState>) -> ApiResult {
    Ok(Json(autopilot::snapshot(&state.pool).await?).into_response())
}

pub async fn update_automation(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse(&bytes)?;
    let bot_id = parse_id(body.get("botId")).ok_or_else(|| bad_request("botId is required"))?;
    if data::get_bot_by_id(&state.pool, bot_id).await?.is_none() {
        return Err(not_found("Bot not found"));
    }
    // Numeric settings are clamped by upsert_automation; here we only reject
    // values that are not numbers at all.
    let number = |key: &str, label: &str| -> Result<Option<i64>, ApiError> {
        match body.number(key) {
            None => Ok(None),
            Some(Ok(n)) => Ok(Some(n.round() as i64)),
            Some(Err(())) => Err(bad_request(format!("{label} must be a number"))),
        }
    };
    let patch = AutomationPatch {
        enabled: body.bool("enabled"),
        cadence_minutes: number("cadenceMinutes", "cadenceMinutes")?,
        actions: body.get("actions").and_then(Value::as_array).map(|items| {
            items.iter().map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).collect()
        }),
        daily_limit: number("dailyLimit", "dailyLimit")?,
        require_approval: body.bool("requireApproval"),
        use_model: body.bool("useModel"),
    };
    autopilot::upsert_automation(&state.pool, bot_id, patch).await?;
    let automations = autopilot::list_automations(&state.pool).await?;
    Ok(Json(json!({ "automations": automations })).into_response())
}

/// Runs autonomy work. Callable by the UI heartbeat, by `curl`, or by cron:
///
/// ```text
/// curl -X POST http://127.0.0.1:3000/api/automation/run \
///   -H 'content-type: application/json' \
///   -H "x-autopilot-token: $AUTOPILOT_TOKEN" \
///   -d '{"mode":"tick"}'
/// ```
///
/// If AUTOPILOT_TOKEN is set, a request is accepted only when it comes from
/// the app's own pages (same-origin) or carries the token in the
/// `x-autopilot-token` header. The token is never read from the query string,
/// because URLs end up in logs.
pub async fn run_automation(State(state): State<AppState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    if let Some(expected) = state.settings.autopilot_token.as_deref() {
        let provided = headers.get("x-autopilot-token").and_then(|v| v.to_str().ok());
        if !is_same_origin(&headers) && !secret_matches(provided, expected) {
            return Err(ApiError::Unauthorized("Invalid autopilot token".into()));
        }
    }
    let body = JsonBody::parse_lenient(&bytes);
    let outcomes = if body.string("mode") == "bot" {
        let bot_id = parse_id(body.get("botId")).ok_or_else(|| bad_request("botId is required"))?;
        vec![autopilot::run_bot_cycle(&state.pool, &state.http, bot_id, body.bool("force") != Some(false), None).await?]
    } else {
        autopilot::tick_automations(&state.pool, &state.http).await?
    };
    let snapshot = autopilot::snapshot(&state.pool).await?;
    Ok(Json(json!({ "outcomes": outcomes, "snapshot": snapshot })).into_response())
}

pub async fn decide_run(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse(&bytes)?;
    let id = parse_id(body.get("id")).ok_or_else(|| bad_request("id is required"))?;
    let decision = if body.str("decision") == Some("dismiss") { Decision::Dismiss } else { Decision::Approve };
    let dismissing = matches!(decision, Decision::Dismiss);
    match autopilot::approve_run(&state.pool, id, decision).await? {
        Err(message) => Err(bad_request(message)),
        Ok(conversation_id) => {
            let snapshot = autopilot::snapshot(&state.pool).await?;
            let status = if dismissing { "dismissed" } else { "sent" };
            Ok(Json(json!({ "ok": true, "status": status, "conversationId": conversation_id, "snapshot": snapshot })).into_response())
        }
    }
}

pub async fn create_task(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse(&bytes)?;
    let bot_id = parse_id(body.get("botId")).ok_or_else(|| bad_request("botId is required"))?;
    let title = body.string("title").trim().to_string();
    if title.is_empty() {
        return Err(bad_request("title is required"));
    }
    if data::get_bot_by_id(&state.pool, bot_id).await?.is_none() {
        return Err(not_found("Bot not found"));
    }
    let task_id = autopilot::add_task(&state.pool, bot_id, &title, &body.string("detail")).await?;
    let snapshot = autopilot::snapshot(&state.pool).await?;
    Ok((StatusCode::CREATED, Json(json!({ "task": { "id": task_id }, "snapshot": snapshot }))).into_response())
}

pub async fn update_task(State(state): State<AppState>, bytes: Bytes) -> ApiResult {
    let body = JsonBody::parse(&bytes)?;
    let id = parse_id(body.get("id")).ok_or_else(|| bad_request("id is required"))?;
    let done = body.bool("done").unwrap_or(false);
    if !autopilot::set_task_done(&state.pool, id, done).await? {
        return Err(not_found("Task not found"));
    }
    let snapshot = autopilot::snapshot(&state.pool).await?;
    Ok(Json(json!({ "task": { "id": id, "done": done }, "snapshot": snapshot })).into_response())
}
