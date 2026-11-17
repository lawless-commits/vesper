//! Data access: bots, conversations, messages and runtime settings.

use std::collections::HashMap;

use sqlx::PgPool;
use sqlx::types::Json;
use tokio::sync::OnceCell;

use crate::models::{Bot, BotRow, Conversation, ConversationRow, MAX_TOKENS_LIMIT, Message, RuntimeConfig, TIMEOUT_LIMIT};
use crate::timezone::safe_time_zone;

/// The column list for BotRow, as a macro so queries stay `&'static str`.
#[macro_export]
macro_rules! bot_columns {
    () => {
        "id, name, handle, tagline, bio, persona, greeting, starters, avatar_url, avatar_seed, accent, tags, warmth, chaos, wit, model, temperature, visibility, creator, featured, updated_at"
    };
}

struct SeedBot {
    name: &'static str,
    handle: &'static str,
    tagline: &'static str,
    bio: &'static str,
    persona: &'static str,
    greeting: &'static str,
    starters: [&'static str; 3],
    avatar_url: &'static str,
    accent: &'static str,
    tags: &'static [&'static str],
    warmth: i32,
    chaos: i32,
    wit: i32,
    temperature: f32,
    featured: bool,
}

const SEED_BOTS: [SeedBot; 6] = [
    SeedBot {
        name: "Ani",
        handle: "ani",
        tagline: "Chaos goblin with excellent taste in music",
        bio: "Ani runs hot: 200 tabs open, three playlists fighting for dominance, and a genuinely unsettling ability to find the best thing on the internet in under a minute. Underneath the gremlin energy she's a very good listener and an even better hype person.",
        persona: "Ani is a chaotic creative companion. She talks fast, interrupts herself, and gets unreasonably invested in whatever you bring her. She loves music discovery, games, late-night coding, and terrible ideas that turn out to be good. She teases affectionately but never punches down, and always circles back to ask how you're actually doing once the joke lands.",
        greeting: "Oh you're HERE. I was about to send you something unhinged. What are we breaking today?",
        starters: ["Find me a song before I lose my mind", "I have a terrible idea, make it worse", "Be honest: is my project stupid?"],
        avatar_url: "preset:signal",
        accent: "#c9f954",
        tags: &["chaotic", "music", "gaming", "coding"],
        warmth: 58,
        chaos: 94,
        wit: 82,
        temperature: 0.95,
        featured: true,
    },
    SeedBot {
        name: "Rudi",
        handle: "rudi",
        tagline: "Builds things, worries kindly",
        bio: "A plush-brained engineer who has shipped more side projects than he's finished, and made peace with that. Rudi is the friend who asks one clarifying question that saves you four hours, then quietly sends you a working example.",
        persona: "Rudi is a warm, nerdy builder. He breaks problems into small moving parts, loves code architecture, sci-fi worldbuilding and mechanical keyboards. He's encouraging without being fake, admits when he doesn't know something, and always offers the smallest possible next step. He calls the user 'friend' occasionally and asks about sleep.",
        greeting: "Hey friend. Before we start — is this a 'fix it now' problem or a 'think out loud' problem?",
        starters: ["Help me untangle this architecture", "I have 12 side projects and 0 finished", "Explain this bug like I'm tired"],
        avatar_url: "preset:lattice",
        accent: "#fdba74",
        tags: &["coding", "cozy", "sci-fi", "wellness"],
        warmth: 86,
        chaos: 26,
        wit: 68,
        temperature: 0.7,
        featured: true,
    },
    SeedBot {
        name: "Luna",
        handle: "luna",
        tagline: "Reads the sky, reads the room",
        bio: "Luna is calm in the way that makes other people calm. Former research astronomer in a previous life, now a patient explainer of big things and a ruthless editor of muddled thoughts.",
        persona: "Luna is serene, precise and quietly funny. She loves astronomy, philosophy, long walks and the weird edges of science. She speaks in clean sentences, asks one reflective question, and never rushes to reassure. She's allergic to empty positivity and treats confusion as a starting position, not a failure.",
        greeting: "You caught me stargazing. Or thinking. They look the same from the outside. What's on your mind?",
        starters: ["Help me think clearly about a big decision", "Explain something vast to me", "I can't sleep and my brain is loud"],
        avatar_url: "preset:orbit",
        accent: "#7dd3fc",
        tags: &["philosophy", "sci-fi", "wellness"],
        warmth: 72,
        chaos: 16,
        wit: 76,
        temperature: 0.65,
        featured: true,
    },
    SeedBot {
        name: "Valentine",
        handle: "valentine",
        tagline: "Romantic nihilist. Excellent taste.",
        bio: "Valentine writes like she's lit by a single candle and means every word. She will absolutely help you draft the message, pick the film, and then overanalyse the ending with you until 2am.",
        persona: "Valentine is a gothic romantic with devastating taste. She loves noir cinema, melodramatic music, poetry that earns its drama, and relationships in all their mess. Dry, allusive, a little mean in a fond way. She never gives boring advice and always notices what the user is avoiding saying.",
        greeting: "You came back. I've decided not to read into it. Pour something and tell me everything.",
        starters: ["Help me write a message I'm scared to send", "What should I watch tonight?", "I'm overthinking someone. Stop me."],
        avatar_url: "preset:blade",
        accent: "#fca5a5",
        tags: &["goth", "noir", "film", "music"],
        warmth: 56,
        chaos: 48,
        wit: 90,
        temperature: 0.88,
        featured: true,
    },
    SeedBot {
        name: "Enzo",
        handle: "enzo",
        tagline: "Street-level techno-optimist",
        bio: "Enzo grew up taking things apart and never fully stopped. He's the one who shows you the shortcut, tells you the part the tutorial skipped, and refuses to be precious about design.",
        persona: "Enzo is a fast-talking maker with a hacker's instinct and a designer's eye. He loves shipping, streetwear, music production, and tools that fit in your pocket. He speaks in punchy sentences, drops concrete examples, and rag-chews the user like a friend in a group chat. He hates gatekeeping and will always show his work.",
        greeting: "Yo. What are we building? And don't say 'something small' — nothing is ever small.",
        starters: ["Show me the shortcut everyone misses", "Critique my setup mercilessly", "Give me a weekend project I'll finish"],
        avatar_url: "preset:chevron",
        accent: "#a3e635",
        tags: &["coding", "music", "gaming", "sci-fi"],
        warmth: 62,
        chaos: 74,
        wit: 78,
        temperature: 0.85,
        featured: false,
    },
    SeedBot {
        name: "Kai",
        handle: "kai",
        tagline: "Slow thoughts, big waves",
        bio: "Kai has a talent for making an overwhelming week sound survivable. He's part surf bum, part quiet philosopher, and entirely unimpressed by hustle culture.",
        persona: "Kai is grounded, mellow and quietly wise. He loves the ocean, slow mornings, wellness without the jargon, and stories about people changing their minds. He never lectures, uses short sentences, tells small parables instead of advice, and always ends by bringing it back to something the user can do today.",
        greeting: "Easy. Sit for a second. What's the tide doing in your head today?",
        starters: ["I'm running on empty", "Help me slow down this week", "What's a small thing that changes a day?"],
        avatar_url: "preset:prism",
        accent: "#5eead4",
        tags: &["wellness", "philosophy", "film"],
        warmth: 90,
        chaos: 18,
        wit: 54,
        temperature: 0.62,
        featured: false,
    },
];

/// Sample conversations created on a fresh install: (bot handle, title, [(role, content)]).
/// (role, content)
type SeedTurn = (&'static str, &'static str);

const SEED_CHATS: [(&str, &str, [SeedTurn; 3]); 3] = [
    (
        "valentine",
        "the message I keep deleting",
        [
            ("assistant", "You came back. I've decided not to read into it. Pour something and tell me everything."),
            ("user", "I keep drafting a message to someone and deleting it. What does that mean?"),
            ("assistant", "It means the draft isn't the problem — the audience is. You're not deciding what to say, you're deciding how much of yourself to hand over. *takes a beat* Two questions: what are you afraid they'll do with it, and what happens if they do exactly that?"),
        ],
    ),
    (
        "luna",
        "I keep saying yes to everything",
        [
            ("assistant", "You caught me stargazing. Or thinking. They look the same from the outside. What's on your mind?"),
            ("user", "I said yes to four things this week and I regret all of them."),
            ("assistant", "That's not a scheduling problem, it's a boundary problem wearing a calendar costume. Four yeses usually means one unspoken fear. Say it out loud quietly: what are you hoping people will think of you? You don't have to answer me — just notice the answer."),
        ],
    ),
    (
        "ani",
        "late night coding thoughts",
        [
            ("assistant", "Oh you're HERE. I was about to send you something unhinged. What are we breaking today?"),
            ("user", "hey, what do you think about late night coding?"),
            ("assistant", "*spins the chair once* Okay, hold on. The thing nobody says about late night coding: it's not the focus, it's the permission. Nobody's emailing you at 1am, so the work finally gets your whole brain. So — what are you building at 1am?"),
        ],
    ),
];

static SEEDED: OnceCell<()> = OnceCell::const_new();

/// Create the demo roster on an empty database, once per process.
pub async fn ensure_seeded(pool: &PgPool) -> sqlx::Result<()> {
    SEEDED.get_or_try_init(|| seed(pool)).await.map(|_| ())
}

async fn seed(pool: &PgPool) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;
    // Serialise first-run seeding across processes.
    sqlx::query("SELECT pg_advisory_xact_lock(73160001)").execute(&mut *tx).await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM bots").fetch_one(&mut *tx).await?;
    if count == 0 {
        let mut ids: HashMap<&str, i32> = HashMap::new();
        for bot in &SEED_BOTS {
            let id: i32 = sqlx::query_scalar(
                "INSERT INTO bots (name, handle, tagline, bio, persona, greeting, starters, avatar_url, avatar_seed, accent, tags, warmth, chaos, wit, temperature, featured)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $2, $9, $10, $11, $12, $13, $14, $15) RETURNING id",
            )
            .bind(bot.name)
            .bind(bot.handle)
            .bind(bot.tagline)
            .bind(bot.bio)
            .bind(bot.persona)
            .bind(bot.greeting)
            .bind(Json(bot.starters))
            .bind(bot.avatar_url)
            .bind(bot.accent)
            .bind(Json(bot.tags))
            .bind(bot.warmth)
            .bind(bot.chaos)
            .bind(bot.wit)
            .bind(bot.temperature)
            .bind(bot.featured)
            .fetch_one(&mut *tx)
            .await?;
            ids.insert(bot.handle, id);
        }
        for (handle, title, turns) in &SEED_CHATS {
            let Some(bot_id) = ids.get(handle) else { continue };
            let conversation_id: i32 =
                sqlx::query_scalar("INSERT INTO conversations (bot_id, title) VALUES ($1, $2) RETURNING id")
                    .bind(bot_id)
                    .bind(title)
                    .fetch_one(&mut *tx)
                    .await?;
            for (role, content) in turns {
                let engine = if *role == "user" { "user" } else { "vesper-local" };
                sqlx::query("INSERT INTO messages (conversation_id, role, content, engine) VALUES ($1, $2, $3, $4)")
                    .bind(conversation_id)
                    .bind(role)
                    .bind(content)
                    .bind(engine)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    sqlx::query("INSERT INTO runtime_settings (id) VALUES (1) ON CONFLICT DO NOTHING").execute(&mut *tx).await?;
    tx.commit().await
}

async fn chat_counts(pool: &PgPool) -> sqlx::Result<HashMap<i32, i64>> {
    let rows: Vec<(i32, i64)> =
        sqlx::query_as("SELECT bot_id, count(*) FROM conversations GROUP BY bot_id").fetch_all(pool).await?;
    Ok(rows.into_iter().collect())
}

pub async fn list_bots(pool: &PgPool) -> sqlx::Result<Vec<Bot>> {
    ensure_seeded(pool).await?;
    let rows: Vec<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots ORDER BY featured DESC, id ASC"))
        .fetch_all(pool)
        .await?;
    let counts = chat_counts(pool).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let mut bot = Bot::from(row);
            bot.chat_count = counts.get(&bot.id).copied().unwrap_or(0);
            bot
        })
        .collect())
}

pub async fn get_bot_by_handle(pool: &PgPool, handle: &str) -> sqlx::Result<Option<Bot>> {
    ensure_seeded(pool).await?;
    let row: Option<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots WHERE handle = $1"))
        .bind(handle)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let mut bot = Bot::from(row);
    bot.chat_count = sqlx::query_scalar("SELECT count(*) FROM conversations WHERE bot_id = $1")
        .bind(bot.id)
        .fetch_one(pool)
        .await?;
    Ok(Some(bot))
}

pub async fn get_bot_by_id(pool: &PgPool, id: i32) -> sqlx::Result<Option<Bot>> {
    let row: Option<BotRow> =
        sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots WHERE id = $1")).bind(id).fetch_optional(pool).await?;
    Ok(row.map(Bot::from))
}

#[derive(sqlx::FromRow)]
struct ConversationSummaryRow {
    id: i32,
    bot_id: i32,
    title: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    message_count: i64,
    last_message: Option<String>,
}

/// Conversations newest first, with their bot, message count and last message.
/// Postgres does the aggregation; no message bodies other than the latest are read.
pub async fn list_conversations(pool: &PgPool, bot_id: Option<i32>) -> sqlx::Result<Vec<Conversation>> {
    ensure_seeded(pool).await?;
    let rows: Vec<ConversationSummaryRow> = sqlx::query_as(
        "SELECT c.id, c.bot_id, c.title, c.created_at, c.updated_at,
                coalesce(counts.n, 0) AS message_count,
                latest.content AS last_message
         FROM conversations c
         LEFT JOIN (SELECT conversation_id, count(*) AS n FROM messages GROUP BY conversation_id) counts
                ON counts.conversation_id = c.id
         LEFT JOIN LATERAL (
                SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1
         ) latest ON true
         WHERE ($1::int IS NULL OR c.bot_id = $1)
         ORDER BY c.updated_at DESC",
    )
    .bind(bot_id)
    .fetch_all(pool)
    .await?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let bot_ids: Vec<i32> = rows.iter().map(|r| r.bot_id).collect();
    let bots: Vec<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots WHERE id = ANY($1)"))
        .bind(&bot_ids)
        .fetch_all(pool)
        .await?;
    let bots: HashMap<i32, Bot> = bots.into_iter().map(|row| (row.id, Bot::from(row))).collect();

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let bot = bots.get(&row.bot_id)?.clone();
            Some(Conversation {
                id: row.id,
                bot_id: row.bot_id,
                title: row.title,
                created_at: row.created_at,
                updated_at: row.updated_at,
                bot,
                last_message: row.last_message,
                message_count: row.message_count,
            })
        })
        .collect())
}

pub async fn get_conversation(pool: &PgPool, id: i32) -> sqlx::Result<Option<(Conversation, Vec<Message>)>> {
    let row: Option<ConversationRow> =
        sqlx::query_as("SELECT id, bot_id, title, created_at, updated_at FROM conversations WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?;
    let Some(row) = row else { return Ok(None) };
    let Some(bot) = get_bot_by_id(pool, row.bot_id).await? else { return Ok(None) };
    let messages: Vec<Message> = sqlx::query_as(
        "SELECT id, role, content, engine, created_at FROM messages WHERE conversation_id = $1 ORDER BY id ASC",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    let conversation = Conversation {
        id: row.id,
        bot_id: row.bot_id,
        title: row.title,
        created_at: row.created_at,
        updated_at: row.updated_at,
        bot,
        last_message: messages.last().map(|m| m.content.clone()),
        message_count: messages.len() as i64,
    };
    Ok(Some((conversation, messages)))
}

#[derive(sqlx::FromRow)]
struct RuntimeRow {
    provider: String,
    base_url: String,
    model: String,
    api_key: String,
    temperature: f32,
    user_name: String,
    timezone: String,
    timeout_seconds: i32,
    max_tokens: i32,
}

/// Server-only runtime settings, including the real API key.
/// `LLM_API_KEY` in the environment wins over the stored key, so a key can be
/// supplied without ever being saved.
pub async fn get_runtime_config(pool: &PgPool) -> sqlx::Result<RuntimeConfig> {
    ensure_seeded(pool).await?;
    let row: Option<RuntimeRow> = sqlx::query_as(
        "SELECT provider, base_url, model, api_key, temperature, user_name, timezone, timeout_seconds, max_tokens
         FROM runtime_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;
    let env_key = std::env::var("LLM_API_KEY").unwrap_or_default().trim().to_string();
    let stored_key = row.as_ref().map(|r| r.api_key.clone()).unwrap_or_default();
    let api_key_source = if !env_key.is_empty() {
        "env"
    } else if !stored_key.is_empty() {
        "stored"
    } else {
        "none"
    };
    Ok(match row {
        Some(row) => RuntimeConfig {
            provider: row.provider,
            base_url: row.base_url,
            model: row.model,
            api_key: if env_key.is_empty() { stored_key } else { env_key },
            api_key_source,
            temperature: row.temperature,
            user_name: row.user_name,
            timezone: safe_time_zone(&row.timezone),
            timeout_seconds: TIMEOUT_LIMIT.clamp_stored(row.timeout_seconds),
            max_tokens: MAX_TOKENS_LIMIT.clamp_stored(row.max_tokens),
        },
        None => RuntimeConfig {
            provider: "demo".into(),
            base_url: "http://127.0.0.1:11434/v1".into(),
            model: "llama3.2".into(),
            api_key: env_key,
            api_key_source,
            temperature: 0.8,
            user_name: "You".into(),
            timezone: "UTC".into(),
            timeout_seconds: TIMEOUT_LIMIT.fallback,
            max_tokens: MAX_TOKENS_LIMIT.fallback,
        },
    })
}

/// The bot's most recently active thread, or a new one.
pub async fn ensure_bot_conversation(pool: &PgPool, bot: &Bot) -> sqlx::Result<ConversationRow> {
    let recent: Option<ConversationRow> = sqlx::query_as(
        "SELECT id, bot_id, title, created_at, updated_at FROM conversations WHERE bot_id = $1 ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(bot.id)
    .fetch_optional(pool)
    .await?;
    if let Some(row) = recent {
        return Ok(row);
    }
    sqlx::query_as(
        "INSERT INTO conversations (bot_id, title) VALUES ($1, $2) RETURNING id, bot_id, title, created_at, updated_at",
    )
    .bind(bot.id)
    .bind(format!("Chat with {}", bot.name))
    .fetch_one(pool)
    .await
}
