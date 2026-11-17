//! Database rows and the JSON shapes the API returns.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::FromRow;
use sqlx::types::Json;

/// Serialise a Postgres `real` the way it was entered (0.8, not 0.800000011920929).
fn tidy_f32<S: serde::Serializer>(value: &f32, serializer: S) -> Result<S::Ok, S::Error> {
    let shortest: f64 = value.to_string().parse().unwrap_or(*value as f64);
    serializer.serialize_f64(shortest)
}

fn string_list(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
        _ => Vec::new(),
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct BotRow {
    pub id: i32,
    pub name: String,
    pub handle: String,
    pub tagline: String,
    pub bio: String,
    pub persona: String,
    pub greeting: String,
    pub starters: Json<Value>,
    pub avatar_url: Option<String>,
    pub avatar_seed: String,
    pub accent: String,
    pub tags: Json<Value>,
    pub warmth: i32,
    pub chaos: i32,
    pub wit: i32,
    pub model: String,
    pub temperature: f32,
    pub visibility: String,
    pub creator: String,
    pub featured: bool,
    pub updated_at: DateTime<Utc>,
}

/// A bot as the app and API see it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub id: i32,
    pub name: String,
    pub handle: String,
    pub tagline: String,
    pub bio: String,
    pub persona: String,
    pub greeting: String,
    pub starters: Vec<String>,
    pub avatar_url: Option<String>,
    pub avatar_seed: String,
    pub accent: String,
    pub tags: Vec<String>,
    pub warmth: i32,
    pub chaos: i32,
    pub wit: i32,
    pub model: String,
    #[serde(serialize_with = "tidy_f32")]
    pub temperature: f32,
    pub visibility: String,
    pub creator: String,
    pub featured: bool,
    pub updated_at: DateTime<Utc>,
    pub chat_count: i64,
}

impl From<BotRow> for Bot {
    fn from(row: BotRow) -> Self {
        Bot {
            id: row.id,
            starters: string_list(&row.starters.0),
            tags: string_list(&row.tags.0),
            name: row.name,
            handle: row.handle,
            tagline: row.tagline,
            bio: row.bio,
            persona: row.persona,
            greeting: row.greeting,
            avatar_url: row.avatar_url,
            avatar_seed: row.avatar_seed,
            accent: row.accent,
            warmth: row.warmth,
            chaos: row.chaos,
            wit: row.wit,
            model: row.model,
            temperature: row.temperature,
            visibility: row.visibility,
            creator: row.creator,
            featured: row.featured,
            updated_at: row.updated_at,
            chat_count: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i32,
    pub role: String,
    pub content: String,
    pub engine: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRow {
    pub id: i32,
    pub bot_id: i32,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A conversation with its bot and a summary of its messages.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: i32,
    pub bot_id: i32,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub bot: Bot,
    pub last_message: Option<String>,
    pub message_count: i64,
}

/// Client-safe runtime settings. The API key never leaves the server; the
/// browser only learns whether one exists and where it comes from.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeView {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
    /// "env" = LLM_API_KEY environment variable, "stored" = saved in the database.
    pub api_key_source: &'static str,
    #[serde(serialize_with = "tidy_f32")]
    pub temperature: f32,
    pub user_name: String,
    /// IANA timezone for autopilot quiet hours and the daily cap.
    pub timezone: String,
    /// Seconds to wait for the model before falling back (10-300).
    pub timeout_seconds: i32,
    /// Upper bound on reply length in tokens, applied to every provider (64-4000).
    pub max_tokens: i32,
}

/// Server-only runtime settings, including the real API key. Never serialise
/// this into a response; use [`RuntimeConfig::view`] for anything the browser sees.
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub api_key_source: &'static str,
    pub temperature: f32,
    pub user_name: String,
    pub timezone: String,
    pub timeout_seconds: i32,
    pub max_tokens: i32,
}

impl RuntimeConfig {
    pub fn view(&self) -> RuntimeView {
        RuntimeView {
            provider: self.provider.clone(),
            base_url: self.base_url.clone(),
            model: self.model.clone(),
            has_api_key: !self.api_key.is_empty(),
            api_key_source: self.api_key_source,
            temperature: self.temperature,
            user_name: self.user_name.clone(),
            timezone: self.timezone.clone(),
            timeout_seconds: self.timeout_seconds,
            max_tokens: self.max_tokens,
        }
    }
}

pub struct RuntimeLimit {
    pub min: i32,
    pub max: i32,
    pub fallback: i32,
}

pub const TIMEOUT_LIMIT: RuntimeLimit = RuntimeLimit { min: 10, max: 300, fallback: 90 };
pub const MAX_TOKENS_LIMIT: RuntimeLimit = RuntimeLimit { min: 64, max: 4000, fallback: 600 };

impl RuntimeLimit {
    /// Clamp a user-supplied value into range; non-numbers get the default.
    pub fn clamp_value(&self, value: Option<&Value>) -> i32 {
        let number = match value {
            Some(Value::Number(n)) => n.as_f64(),
            Some(Value::String(s)) if !s.trim().is_empty() => s.trim().parse::<f64>().ok(),
            _ => None,
        };
        match number {
            Some(n) if n.is_finite() => (n.round() as i64).clamp(self.min as i64, self.max as i64) as i32,
            _ => self.fallback,
        }
    }

    pub fn clamp_stored(&self, value: i32) -> i32 {
        value.clamp(self.min, self.max)
    }
}

// ----- Autopilot -----

pub const ACTION_KINDS: [&str; 4] = ["journal", "dm", "relay", "task"];

pub struct ActionMeta {
    pub kind: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub glyph: &'static str,
}

pub const ACTION_META: [ActionMeta; 4] = [
    ActionMeta { kind: "journal", label: "Journal", hint: "Publish a thought to its own transmission feed", glyph: "✳" },
    ActionMeta { kind: "dm", label: "Message you", hint: "Start a chat thread with you unprompted", glyph: "✉" },
    ActionMeta { kind: "relay", label: "Relay", hint: "Talk to another bot in your roster", glyph: "⇄" },
    ActionMeta { kind: "task", label: "Task", hint: "Add a follow-up to the shared task list", glyph: "✓" },
];

pub fn action_meta(kind: &str) -> &'static ActionMeta {
    ACTION_META.iter().find(|m| m.kind == kind).unwrap_or(&ACTION_META[0])
}

#[derive(Debug, Clone, FromRow)]
pub struct AutomationRow {
    pub id: i32,
    pub bot_id: i32,
    pub enabled: bool,
    pub cadence_minutes: i32,
    pub actions: Json<Value>,
    pub daily_limit: i32,
    pub require_approval: bool,
    pub use_model: bool,
    pub last_run_at: Option<DateTime<Utc>>,
}

impl AutomationRow {
    pub fn action_list(&self) -> Vec<String> {
        let list = string_list(&self.actions.0);
        if list.is_empty() { vec!["journal".to_string()] } else { list }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationView {
    pub bot_id: i32,
    pub bot: Bot,
    pub enabled: bool,
    pub cadence_minutes: i32,
    pub actions: Vec<String>,
    pub daily_limit: i32,
    pub require_approval: bool,
    pub use_model: bool,
    pub last_run_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView {
    pub id: i32,
    pub bot_id: i32,
    pub bot_name: String,
    pub bot_handle: String,
    pub kind: String,
    pub status: String,
    pub content: String,
    pub partner_bot_id: Option<i32>,
    pub partner_content: Option<String>,
    pub partner_name: Option<String>,
    pub conversation_id: Option<i32>,
    /// Who wrote the text: "model", "template", "mixed", or None for older runs.
    pub source: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: i32,
    pub bot_id: i32,
    pub bot_name: String,
    pub title: String,
    pub detail: String,
    pub done: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotStats {
    pub enabled: usize,
    pub total: usize,
    pub actions_today: i64,
    pub pending: usize,
    pub open_tasks: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotSnapshot {
    pub automations: Vec<AutomationView>,
    pub runs: Vec<RunView>,
    pub tasks: Vec<TaskView>,
    pub stats: AutopilotStats,
    /// Timezone that quiet hours and "actions today" are measured in.
    pub timezone: String,
}
