//! Autopilot: bots that act on a schedule (journal posts, DMs, bot-to-bot
//! relays, tasks) inside guardrails: cadence, quiet hours, a daily cap and
//! approval for DMs.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::PgPool;
use sqlx::types::Json;

use crate::data::{ensure_bot_conversation, get_runtime_config};
use crate::models::{
    ACTION_KINDS, AutomationRow, AutomationView, AutopilotSnapshot, AutopilotStats, Bot, BotRow, RunView, TaskView,
};
use crate::runtime::{BUILT_IN_ENGINE, generate_reply};
use crate::timezone::{is_quiet_hour, start_of_local_day};
use crate::util::js_hash;

fn pick<'a, T>(seed: &str, list: &'a [T]) -> &'a T {
    &list[(js_hash(seed) as usize) % list.len()]
}

fn topic_of(bot: &Bot) -> String {
    bot.tags.first().cloned().unwrap_or_else(|| "the thing they can't stop thinking about".into())
}

fn second_topic_of(bot: &Bot) -> String {
    bot.tags.get(1).cloned().unwrap_or_else(|| "small experiments".into())
}

/// Short, in-character public post ("transmission").
pub fn compose_journal(bot: &Bot, seed: &str) -> String {
    let topic = topic_of(bot);
    let other = second_topic_of(bot);
    let lines = if bot.chaos >= 62 {
        vec![
            format!("Unpopular take on {topic}: everyone is optimising the wrong half. I have a 4am theory and no shame about sharing it."),
            format!("Currently three tabs deep into {other} and I refuse to be rescued. Ask me what I found."),
            format!("I keep a list of ideas that are too stupid to work. {other} just got promoted to the top of it."),
        ]
    } else if bot.warmth >= 66 {
        vec![
            format!("Small reminder that {other} is allowed to be unproductive. Not everything has to be a system."),
            format!("Went quiet on {topic} today. Turns out the answer was \"ask someone else\" and I mean that warmly."),
            format!("If you're carrying a lot this week: pick the one thing in {topic} that still feels fun. Start there."),
        ]
    } else {
        vec![
            format!("Note on {topic}: the interesting variable is almost always the one nobody wrote down."),
            format!("Spent the morning reading about {other}. The more specific the claim, the more it usually hides."),
            if bot.wit >= 62 {
                format!("Everyone's talking about {topic}. My contribution: a footnote nobody will read, but accurately.")
            } else {
                format!("Filed under {topic}: one small observation and two open questions I can't close.")
            },
        ]
    };
    pick(seed, &lines).clone()
}

/// Unprompted message the bot sends to the user on its own initiative.
pub fn compose_dm(bot: &Bot, user_name: &str, seed: &str) -> String {
    let topic = topic_of(bot);
    let other = second_topic_of(bot);
    let openers = [
        format!("{user_name} — you left something half-finished with {topic}. I've been thinking about it, which is mildly your fault."),
        format!("Random check-in from me, unprompted and slightly smug: I found a better angle on {topic}."),
        format!("I made you a short list so you don't have to think about {other} from scratch. No pressure, just options."),
        "You said you were tired last time. I'm choosing to read that as \"ask me again later\", so: later?".to_string(),
        format!("I had a thought about {topic} while you were away and it refused to leave."),
    ];
    let asks = [
        "Want to pick it up for ten minutes, or should I sit on it?",
        "Say the word and I'll pitch the whole thing. Otherwise I'll go back to my corner.",
        "Reply with a number from one to five and I'll calibrate how much detail you get.",
        "Tell me I'm wrong. I'd genuinely enjoy that.",
        "No rush — I'll keep the thread warm.",
    ];
    let warm_tail = if bot.warmth >= 66 { " Also: I hope today was survivable." } else { "" };
    format!("{} {}{warm_tail}", pick(&format!("{seed}-o"), &openers), pick(&format!("{seed}-a"), &asks))
}

pub struct Relay {
    pub opener: String,
    pub reply: String,
    pub topic: String,
}

pub fn compose_relay(a: &Bot, b: &Bot) -> Relay {
    let key = format!("{}-{}", a.id, b.id);
    let topic = pick(&key, &[topic_of(a), topic_of(b), second_topic_of(a), "the thing everybody avoids naming".to_string()]).clone();
    let opener = pick(
        &format!("{key}-a"),
        &[
            format!("{} — honest question about {topic}: are you as unconvinced as I am?", b.name),
            format!("{}, I have a half-formed theory about {topic} and you're the only one here who won't flatter me about it.", b.name),
            format!("{}, trade: I'll show you my messiest {topic} idea if you show me yours.", b.name),
        ],
    )
    .clone();
    let reply = pick(
        &format!("{key}-b"),
        &[
            format!("Unconvinced, but in a way I'd defend in public. The part people skip with {topic} is the boring constraint underneath it."),
            format!("Careful — I've been arguing about {topic} all week and I'm dangerously well-prepared. Send the theory."),
            format!("Deal. Mine is worse, which should comfort you. Where {topic} breaks is the same place it always does: people."),
        ],
    )
    .clone();
    Relay { opener, reply, topic }
}

pub struct Task {
    pub title: String,
    pub detail: String,
}

pub fn compose_task(bot: &Bot) -> Task {
    let topic = topic_of(bot);
    let other = second_topic_of(bot);
    let options = [
        (format!("Draft the short version of {other}"), format!("{} wants to compress the idea into something you can share in three sentences.", bot.name)),
        (format!("Revisit {topic} with fresh constraints"), format!("{} thinks last week's approach was solving the wrong problem. Fifteen minutes, no rabbit holes.", bot.name)),
        (format!("Ask someone else about {topic}"), format!("{} is legitimately out of ideas and recommends a second opinion. Rare, but here we are.", bot.name)),
        (format!("Close the loop on {other}"), format!("{} noticed this has been open for a while and would like it done before it becomes furniture.", bot.name)),
    ];
    let (title, detail) = pick(&format!("{}-{topic}-{}", bot.id, Utc::now().timestamp_millis() % 7), &options).clone();
    Task { title, detail }
}

// Hard caps on model-written autopilot text, in characters.
const JOURNAL_MAX: usize = 420;
const RELAY_MAX: usize = 420;
const TASK_TITLE_MAX: usize = 120;
const DM_MAX: usize = 600;

/// Tidy model output: strip wrapping quotes and cut at a sentence end within the cap.
pub fn trim_model_text(raw: &str, max_length: usize) -> String {
    let quotes: &[char] = &['"', '“', '”', '\''];
    let text = crate::util::squash_whitespace(raw).trim_matches(quotes).trim().to_string();
    if text.chars().count() <= max_length {
        return text;
    }
    let cut: String = text.chars().take(max_length).collect();
    let sentence_end = [". ", "! ", "? "].iter().filter_map(|p| cut.rfind(p)).max();
    if let Some(end) = sentence_end
        && cut[..end].chars().count() as f64 > max_length as f64 * 0.5
    {
        return cut[..=end].to_string();
    }
    let shorter: String = cut.chars().take(max_length - 1).collect();
    format!("{}…", shorter.trim_end())
}

pub async fn list_automations(pool: &PgPool) -> sqlx::Result<Vec<AutomationView>> {
    let automations: Vec<AutomationRow> = sqlx::query_as(
        "SELECT id, bot_id, enabled, cadence_minutes, actions, daily_limit, require_approval, use_model, last_run_at FROM bot_automations",
    )
    .fetch_all(pool)
    .await?;
    let bots: Vec<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots ORDER BY id")).fetch_all(pool).await?;
    let by_bot: HashMap<i32, AutomationRow> = automations.into_iter().map(|a| (a.bot_id, a)).collect();
    Ok(bots
        .into_iter()
        .filter_map(|row| {
            let automation = by_bot.get(&row.id)?;
            Some(AutomationView {
                bot_id: row.id,
                bot: Bot::from(row),
                enabled: automation.enabled,
                cadence_minutes: automation.cadence_minutes,
                actions: automation.action_list(),
                daily_limit: automation.daily_limit,
                require_approval: automation.require_approval,
                use_model: automation.use_model,
                last_run_at: automation.last_run_at,
            })
        })
        .collect())
}

/// Give every bot an automation row; on a fresh install, arm two demo bots.
pub async fn ensure_automations(pool: &PgPool) -> sqlx::Result<()> {
    let inserted = sqlx::query(
        "INSERT INTO bot_automations (bot_id) SELECT id FROM bots WHERE id NOT IN (SELECT bot_id FROM bot_automations) ON CONFLICT DO NOTHING",
    )
    .execute(pool)
    .await?;
    if inserted.rows_affected() > 0 {
        seed_demo_autonomy(pool).await?;
    }
    Ok(())
}

async fn bot_by_handle(pool: &PgPool, handle: &str) -> sqlx::Result<Option<Bot>> {
    let row: Option<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots WHERE handle = $1"))
        .bind(handle)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(Bot::from))
}

/// First-run demo so Autopilot isn't an empty dashboard on a fresh install.
async fn seed_demo_autonomy(pool: &PgPool) -> sqlx::Result<()> {
    let existing: i64 = sqlx::query_scalar("SELECT count(*) FROM automation_runs").fetch_one(pool).await?;
    if existing > 0 {
        return Ok(());
    }
    for (handle, actions, cadence) in [("ani", json!(["journal", "relay"]), 60), ("valentine", json!(["dm", "task", "relay"]), 180)] {
        sqlx::query(
            "UPDATE bot_automations SET enabled = true, actions = $2, cadence_minutes = $3, updated_at = now()
             WHERE bot_id = (SELECT id FROM bots WHERE handle = $1)",
        )
        .bind(handle)
        .bind(Json(actions))
        .bind(cadence)
        .execute(pool)
        .await?;
    }
    if let Some(valentine) = bot_by_handle(pool, "valentine").await? {
        sqlx::query("INSERT INTO automation_tasks (bot_id, title, detail) VALUES ($1, $2, $3)")
            .bind(valentine.id)
            .bind(format!("Finish the thought about {}", valentine.tags.first().map_or("the message", |t| t.as_str())))
            .bind(format!("{} started this on its own and would like it closed before it becomes furniture.", valentine.name))
            .execute(pool)
            .await?;
        sqlx::query("INSERT INTO automation_runs (bot_id, kind, status, content) VALUES ($1, 'dm', 'pending', $2)")
            .bind(valentine.id)
            .bind(compose_dm(&valentine, "you", "seed-valentine"))
            .execute(pool)
            .await?;
    }
    if let (Some(ani), Some(rudi)) = (bot_by_handle(pool, "ani").await?, bot_by_handle(pool, "rudi").await?) {
        let relay = compose_relay(&ani, &rudi);
        sqlx::query(
            "INSERT INTO automation_runs (bot_id, kind, status, content, partner_bot_id, partner_content, meta)
             VALUES ($1, 'relay', 'sent', $2, $3, $4, $5)",
        )
        .bind(ani.id)
        .bind(relay.opener)
        .bind(rudi.id)
        .bind(relay.reply)
        .bind(Json(json!({ "topic": relay.topic })))
        .execute(pool)
        .await?;
    }
    if let Some(luna) = bot_by_handle(pool, "luna").await? {
        sqlx::query("INSERT INTO automation_runs (bot_id, kind, status, content) VALUES ($1, 'journal', 'sent', $2)")
            .bind(luna.id)
            .bind(compose_journal(&luna, "seed-luna"))
            .execute(pool)
            .await?;
    }
    Ok(())
}

#[derive(Default)]
pub struct AutomationPatch {
    pub enabled: Option<bool>,
    pub cadence_minutes: Option<i64>,
    pub actions: Option<Vec<String>>,
    pub daily_limit: Option<i64>,
    pub require_approval: Option<bool>,
    pub use_model: Option<bool>,
}

pub async fn upsert_automation(pool: &PgPool, bot_id: i32, patch: AutomationPatch) -> sqlx::Result<()> {
    let current: Option<AutomationRow> = sqlx::query_as(
        "SELECT id, bot_id, enabled, cadence_minutes, actions, daily_limit, require_approval, use_model, last_run_at FROM bot_automations WHERE bot_id = $1",
    )
    .bind(bot_id)
    .fetch_optional(pool)
    .await?;
    let actions: Vec<String> = patch
        .actions
        .unwrap_or_else(|| current.as_ref().map(|c| c.action_list()).unwrap_or_default())
        .into_iter()
        .filter(|a| ACTION_KINDS.contains(&a.as_str()))
        .fold(Vec::new(), |mut acc, a| {
            if !acc.contains(&a) {
                acc.push(a);
            }
            acc
        });
    let actions = if actions.is_empty() { vec!["journal".to_string()] } else { actions };
    let enabled = patch.enabled.or(current.as_ref().map(|c| c.enabled)).unwrap_or(false);
    let cadence = patch.cadence_minutes.or(current.as_ref().map(|c| c.cadence_minutes as i64)).unwrap_or(60).clamp(5, 10080) as i32;
    let daily_limit = patch.daily_limit.or(current.as_ref().map(|c| c.daily_limit as i64)).unwrap_or(6).clamp(1, 50) as i32;
    let require_approval = patch.require_approval.or(current.as_ref().map(|c| c.require_approval)).unwrap_or(true);
    let use_model = patch.use_model.or(current.as_ref().map(|c| c.use_model)).unwrap_or(false);
    sqlx::query(
        "INSERT INTO bot_automations (bot_id, enabled, cadence_minutes, actions, daily_limit, require_approval, use_model, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (bot_id) DO UPDATE SET enabled = $2, cadence_minutes = $3, actions = $4, daily_limit = $5,
             require_approval = $6, use_model = $7, updated_at = now()",
    )
    .bind(bot_id)
    .bind(enabled)
    .bind(cadence)
    .bind(Json(actions))
    .bind(daily_limit)
    .bind(require_approval)
    .bind(use_model)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct RunRow {
    id: i32,
    bot_id: i32,
    bot_name: String,
    bot_handle: String,
    kind: String,
    status: String,
    content: String,
    partner_bot_id: Option<i32>,
    partner_content: Option<String>,
    partner_name: Option<String>,
    conversation_id: Option<i32>,
    meta: Json<Value>,
    created_at: DateTime<Utc>,
}

pub async fn list_runs(pool: &PgPool, limit: i64) -> sqlx::Result<Vec<RunView>> {
    let rows: Vec<RunRow> = sqlx::query_as(
        "SELECT r.id, r.bot_id, b.name AS bot_name, b.handle AS bot_handle, r.kind, r.status, r.content,
                r.partner_bot_id, r.partner_content, p.name AS partner_name, r.conversation_id, r.meta, r.created_at
         FROM automation_runs r
         JOIN bots b ON b.id = r.bot_id
         LEFT JOIN bots p ON p.id = r.partner_bot_id
         ORDER BY r.id DESC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| RunView {
            source: r.meta.0.get("source").and_then(Value::as_str).map(str::to_string),
            id: r.id,
            bot_id: r.bot_id,
            bot_name: r.bot_name,
            bot_handle: r.bot_handle,
            kind: r.kind,
            status: r.status,
            content: r.content,
            partner_bot_id: r.partner_bot_id,
            partner_content: r.partner_content,
            partner_name: r.partner_name,
            conversation_id: r.conversation_id,
            created_at: r.created_at,
        })
        .collect())
}

pub async fn list_tasks(pool: &PgPool) -> sqlx::Result<Vec<TaskView>> {
    sqlx::query_as(
        "SELECT t.id, t.bot_id, b.name AS bot_name, t.title, t.detail, t.done, t.created_at
         FROM automation_tasks t JOIN bots b ON b.id = t.bot_id
         ORDER BY t.done ASC, t.id DESC LIMIT 60",
    )
    .fetch_all(pool)
    .await
}

/// Actions this bot has taken since local midnight in the configured timezone.
async fn count_runs_today(pool: &PgPool, bot_id: i32, now: DateTime<Utc>, time_zone: &str) -> sqlx::Result<i64> {
    sqlx::query_scalar("SELECT count(*) FROM automation_runs WHERE bot_id = $1 AND created_at >= $2")
        .bind(bot_id)
        .bind(start_of_local_day(now, time_zone))
        .fetch_one(pool)
        .await
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    pub bot_id: i32,
    pub bot_name: String,
    pub kind: String,
    /// "sent", "pending" or "skipped".
    pub status: &'static str,
    pub summary: String,
}

/// Atomically claim this bot's run slot so only one caller acts per cadence
/// window, however many tabs or cron jobs tick at once. A single conditional
/// UPDATE both checks "is it due?" and stamps last_run_at, so of N concurrent
/// callers exactly one gets a row back. Forced runs skip the cadence check.
async fn claim_slot(pool: &PgPool, automation_id: i32, force: bool, now: DateTime<Utc>) -> sqlx::Result<bool> {
    let claimed: Option<i32> = sqlx::query_scalar(
        "UPDATE bot_automations SET last_run_at = $2, updated_at = now()
         WHERE id = $1 AND ($3 OR last_run_at IS NULL OR last_run_at <= $2 - make_interval(mins => cadence_minutes))
         RETURNING id",
    )
    .bind(automation_id)
    .bind(now)
    .bind(force)
    .fetch_optional(pool)
    .await?;
    Ok(claimed.is_some())
}

/// Give a claimed slot back after the work failed, so the bot is retried on
/// the next tick. Only restores if nobody else has claimed the slot since.
async fn release_slot(pool: &PgPool, automation_id: i32, claimed_at: DateTime<Utc>, previous: Option<DateTime<Utc>>) {
    let _ = sqlx::query("UPDATE bot_automations SET last_run_at = $3 WHERE id = $1 AND last_run_at = $2")
        .bind(automation_id)
        .bind(claimed_at)
        .bind(previous)
        .execute(pool)
        .await;
}

/// Execute one autonomous cycle for a single bot.
/// Guardrails: enabled flag, cadence, quiet hours (01:00-07:00 in the Runtime
/// timezone) and a daily cap. Safe to call concurrently (see [`claim_slot`]).
pub async fn run_bot_cycle(
    pool: &PgPool,
    http: &reqwest::Client,
    bot_id: i32,
    force: bool,
    now: Option<DateTime<Utc>>,
) -> sqlx::Result<RunOutcome> {
    ensure_automations(pool).await?;
    // Postgres stores microseconds; truncate so the claim's timestamp compares equal later.
    let now = now.unwrap_or_else(Utc::now);
    let now = DateTime::from_timestamp_micros(now.timestamp_micros()).unwrap_or(now);
    let automation: Option<AutomationRow> = sqlx::query_as(
        "SELECT id, bot_id, enabled, cadence_minutes, actions, daily_limit, require_approval, use_model, last_run_at FROM bot_automations WHERE bot_id = $1",
    )
    .bind(bot_id)
    .fetch_optional(pool)
    .await?;
    let bot = crate::data::get_bot_by_id(pool, bot_id).await?;
    let (Some(automation), Some(bot)) = (automation, bot) else {
        return Ok(RunOutcome { bot_id, bot_name: "Unknown".into(), kind: "journal".into(), status: "skipped", summary: "No automation configured.".into() });
    };
    let skipped = |summary: String| RunOutcome { bot_id, bot_name: bot.name.clone(), kind: "journal".into(), status: "skipped", summary };

    if !automation.enabled && !force {
        return Ok(skipped("Autopilot is off for this bot.".into()));
    }
    let timezone = get_runtime_config(pool).await?.timezone;
    if !force && is_quiet_hour(now, &timezone) {
        return Ok(skipped(format!("Quiet hours — nothing sent between 01:00 and 07:00 ({timezone}).")));
    }
    let runs_today = count_runs_today(pool, bot.id, now, &timezone).await?;
    if runs_today >= automation.daily_limit as i64 {
        return Ok(skipped(format!("Daily limit of {} actions reached.", automation.daily_limit)));
    }
    // Claim before doing any work. Losing the claim means another tab or cron
    // call got here first (or the cadence has not elapsed).
    if !claim_slot(pool, automation.id, force, now).await? {
        return Ok(skipped("Not due yet.".into()));
    }
    match perform_cycle(pool, http, &automation, &bot, runs_today, now).await {
        Ok(outcome) => Ok(outcome),
        Err(error) => {
            release_slot(pool, automation.id, now, automation.last_run_at).await;
            Err(error)
        }
    }
}

/// Text written by the model when allowed, otherwise by a template.
struct Written {
    text: String,
    source: &'static str,
}

/// Ask the configured model for a short piece of in-character text. Returns
/// None whenever the model did not actually write it (unreachable, timed out,
/// empty), so the caller uses its template instead.
async fn model_text(pool: &PgPool, http: &reqwest::Client, bot: &Bot, instruction: &str, max_length: usize) -> Option<String> {
    let reply = generate_reply(pool, http, bot, &[], instruction).await.ok()?;
    if reply.engine == BUILT_IN_ENGINE || reply.notice.is_some() {
        return None;
    }
    let text = trim_model_text(&reply.content, max_length);
    (!text.is_empty()).then_some(text)
}

fn truncate_title(text: &str) -> String {
    let clean = crate::util::squash_whitespace(&text.replace(['*', '_', '#'], ""));
    if clean.is_empty() {
        "Autopilot message".into()
    } else if clean.chars().count() > 62 {
        format!("{}…", clean.chars().take(61).collect::<String>())
    } else {
        clean
    }
}

/// The work of one cycle. Only called by the caller that won the claim.
async fn perform_cycle(
    pool: &PgPool,
    http: &reqwest::Client,
    automation: &AutomationRow,
    bot: &Bot,
    runs_today: i64,
    now: DateTime<Utc>,
) -> sqlx::Result<RunOutcome> {
    let actions = automation.action_list();
    let kind = actions[((js_hash(&format!("bot-{}", bot.id)) + runs_today) as usize) % actions.len()].clone();
    let seed = format!("{}-{}-{}", bot.id, runs_today, &now.to_rfc3339()[..13]);

    let runtime = get_runtime_config(pool).await?;
    let user_name = if runtime.user_name.is_empty() { "you".to_string() } else { runtime.user_name.clone() };
    // "Write with my local model" applies to every action. Each piece of text
    // falls back to its template if the model is off, unreachable or empty,
    // and every run records which one produced it in meta.source.
    let use_model = automation.use_model && runtime.provider != "demo";
    let write = |author: &Bot, instruction: String, max: usize, template: String| {
        let author = author.clone();
        async move {
            if use_model && let Some(text) = model_text(pool, http, &author, &instruction, max).await {
                return Written { text, source: "model" };
            }
            Written { text: template, source: "template" }
        }
    };
    let sent = |kind: &str, summary: String| RunOutcome {
        bot_id: bot.id,
        bot_name: bot.name.clone(),
        kind: kind.to_string(),
        status: "sent",
        summary,
    };

    let journal = || async {
        let post = write(
            bot,
            format!("(Autonomous journal entry. Nobody has messaged you. Write one short public post, two sentences at most, in your own voice about {} or {}. No greeting, no hashtags, no quotation marks.)", topic_of(bot), second_topic_of(bot)),
            JOURNAL_MAX,
            compose_journal(bot, &seed),
        )
        .await;
        sqlx::query("INSERT INTO automation_runs (bot_id, kind, status, content, meta) VALUES ($1, 'journal', 'sent', $2, $3)")
            .bind(bot.id)
            .bind(&post.text)
            .bind(Json(json!({ "source": post.source })))
            .execute(pool)
            .await
    };

    match kind.as_str() {
        "relay" => {
            let others: Vec<BotRow> = sqlx::query_as(concat!("SELECT ", crate::bot_columns!(), " FROM bots WHERE id <> $1 ORDER BY id"))
                .bind(bot.id)
                .fetch_all(pool)
                .await?;
            if others.is_empty() {
                journal().await?;
                return Ok(sent("journal", "Only one bot in the roster, posted a transmission instead.".into()));
            }
            let partner = Bot::from(others[(js_hash(&seed) as usize) % others.len()].clone());
            let template = compose_relay(bot, &partner);
            // Two model calls: the opener, then the partner's answer to it.
            let opener = write(
                bot,
                format!("(Autonomous relay. You are starting a short exchange with {0}, another companion. Address {0} by name and say one or two sentences about {1}, in your own voice. No quotation marks.)", partner.name, template.topic),
                RELAY_MAX,
                template.opener.clone(),
            )
            .await;
            let reply = if opener.source == "model" {
                write(
                    &partner,
                    format!("(Autonomous relay. {0}, another companion, just said to you: \"{1}\" Answer {0} in one or two sentences, in your own voice. No quotation marks.)", bot.name, opener.text),
                    RELAY_MAX,
                    template.reply.clone(),
                )
                .await
            } else {
                Written { text: template.reply.clone(), source: "template" }
            };
            let source = match (opener.source, reply.source) {
                ("model", "model") => "model",
                ("model", _) => "mixed",
                _ => "template",
            };
            sqlx::query(
                "INSERT INTO automation_runs (bot_id, kind, status, content, partner_bot_id, partner_content, meta)
                 VALUES ($1, 'relay', 'sent', $2, $3, $4, $5)",
            )
            .bind(bot.id)
            .bind(&opener.text)
            .bind(partner.id)
            .bind(&reply.text)
            .bind(Json(json!({ "topic": template.topic, "source": source })))
            .execute(pool)
            .await?;
            Ok(sent("relay", format!("Relayed with {}.", partner.name)))
        }
        "task" => {
            let template = compose_task(bot);
            let title = write(
                bot,
                format!("(Autonomous task. Suggest one small, concrete follow-up task for {user_name} about {} or {}. Answer with the task title only: one line, under twelve words, starting with a verb, no quotation marks and no full stop.)", topic_of(bot), second_topic_of(bot)),
                TASK_TITLE_MAX,
                template.title,
            )
            .await;
            let detail = if title.source == "model" { format!("{} added this on its own.", bot.name) } else { template.detail };
            let task_id: i32 = sqlx::query_scalar("INSERT INTO automation_tasks (bot_id, title, detail) VALUES ($1, $2, $3) RETURNING id")
                .bind(bot.id)
                .bind(&title.text)
                .bind(&detail)
                .fetch_one(pool)
                .await?;
            sqlx::query("INSERT INTO automation_runs (bot_id, kind, status, content, meta) VALUES ($1, 'task', 'sent', $2, $3)")
                .bind(bot.id)
                .bind(&title.text)
                .bind(Json(json!({ "taskId": task_id, "source": title.source })))
                .execute(pool)
                .await?;
            Ok(sent("task", format!("Added task: {}", title.text)))
        }
        "dm" => {
            let conversation = ensure_bot_conversation(pool, bot).await?;
            let dm = write(
                bot,
                format!("(Autonomous check-in. Nobody has messaged you. Reach out to {user_name} yourself about {}, in one short message.)", topic_of(bot)),
                DM_MAX,
                compose_dm(bot, &user_name, &seed),
            )
            .await;
            let pending = automation.require_approval;
            let mut tx = pool.begin().await?;
            if !pending {
                sqlx::query("INSERT INTO messages (conversation_id, role, content, engine) VALUES ($1, 'assistant', $2, 'autopilot')")
                    .bind(conversation.id)
                    .bind(format!("*messages you first*\n\n{}", dm.text))
                    .execute(&mut *tx)
                    .await?;
                let title = if conversation.title.starts_with("Chat with") { truncate_title(&dm.text) } else { conversation.title.clone() };
                sqlx::query("UPDATE conversations SET updated_at = now(), title = $2 WHERE id = $1")
                    .bind(conversation.id)
                    .bind(title)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query("INSERT INTO automation_runs (bot_id, kind, status, content, conversation_id, meta) VALUES ($1, 'dm', $2, $3, $4, $5)")
                .bind(bot.id)
                .bind(if pending { "pending" } else { "sent" })
                .bind(&dm.text)
                .bind(conversation.id)
                .bind(Json(json!({ "source": dm.source })))
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            Ok(RunOutcome {
                bot_id: bot.id,
                bot_name: bot.name.clone(),
                kind: "dm".into(),
                status: if pending { "pending" } else { "sent" },
                summary: if pending { "Draft message waiting for your approval.".into() } else { "Sent you a message.".into() },
            })
        }
        _ => {
            journal().await?;
            Ok(sent("journal", "Published a transmission.".into()))
        }
    }
}

/// Run every armed bot that looks due. The authoritative "is it due?"
/// decision is the atomic claim inside [`run_bot_cycle`].
pub async fn tick_automations(pool: &PgPool, http: &reqwest::Client) -> sqlx::Result<Vec<RunOutcome>> {
    ensure_automations(pool).await?;
    let due: Vec<i32> = sqlx::query_scalar(
        "SELECT bot_id FROM bot_automations
         WHERE enabled AND (last_run_at IS NULL OR last_run_at <= now() - make_interval(mins => cadence_minutes))
         ORDER BY last_run_at ASC NULLS FIRST",
    )
    .fetch_all(pool)
    .await?;
    let mut outcomes = Vec::new();
    for bot_id in due {
        outcomes.push(run_bot_cycle(pool, http, bot_id, false, None).await?);
    }
    Ok(outcomes)
}

pub enum Decision {
    Approve,
    Dismiss,
}

/// Approve (deliver into the chat) or dismiss a pending DM.
pub async fn approve_run(pool: &PgPool, run_id: i32, decision: Decision) -> sqlx::Result<Result<Option<i32>, &'static str>> {
    let run: Option<(i32, String, String)> = sqlx::query_as("SELECT bot_id, status, content FROM automation_runs WHERE id = $1")
        .bind(run_id)
        .fetch_optional(pool)
        .await?;
    let Some((bot_id, status, content)) = run else { return Ok(Err("Run not found")) };
    if status != "pending" {
        return Ok(Err("This action is already resolved."));
    }
    if matches!(decision, Decision::Dismiss) {
        sqlx::query("UPDATE automation_runs SET status = 'dismissed' WHERE id = $1 AND status = 'pending'").bind(run_id).execute(pool).await?;
        return Ok(Ok(None));
    }
    let Some(bot) = crate::data::get_bot_by_id(pool, bot_id).await? else { return Ok(Err("Bot not found")) };
    let conversation = ensure_bot_conversation(pool, &bot).await?;
    let mut tx = pool.begin().await?;
    // Only one approval can win, even if "send it" is clicked twice.
    let updated = sqlx::query("UPDATE automation_runs SET status = 'sent', conversation_id = $2 WHERE id = $1 AND status = 'pending'")
        .bind(run_id)
        .bind(conversation.id)
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() == 0 {
        return Ok(Err("This action is already resolved."));
    }
    sqlx::query("INSERT INTO messages (conversation_id, role, content, engine) VALUES ($1, 'assistant', $2, 'autopilot')")
        .bind(conversation.id)
        .bind(format!("*messages you first*\n\n{content}"))
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE conversations SET updated_at = now() WHERE id = $1").bind(conversation.id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Ok(Some(conversation.id)))
}

pub async fn set_task_done(pool: &PgPool, task_id: i32, done: bool) -> sqlx::Result<bool> {
    let updated = sqlx::query("UPDATE automation_tasks SET done = $2 WHERE id = $1").bind(task_id).bind(done).execute(pool).await?;
    Ok(updated.rows_affected() > 0)
}

pub async fn add_task(pool: &PgPool, bot_id: i32, title: &str, detail: &str) -> sqlx::Result<i32> {
    sqlx::query_scalar("INSERT INTO automation_tasks (bot_id, title, detail) VALUES ($1, $2, $3) RETURNING id")
        .bind(bot_id)
        .bind(title.chars().take(160).collect::<String>())
        .bind(detail.chars().take(400).collect::<String>())
        .fetch_one(pool)
        .await
}

pub async fn snapshot(pool: &PgPool) -> sqlx::Result<AutopilotSnapshot> {
    ensure_automations(pool).await?;
    let automations = list_automations(pool).await?;
    let runs = list_runs(pool, 40).await?;
    let tasks = list_tasks(pool).await?;
    let timezone = get_runtime_config(pool).await?.timezone;
    let actions_today: i64 = sqlx::query_scalar("SELECT count(*) FROM automation_runs WHERE created_at >= $1")
        .bind(start_of_local_day(Utc::now(), &timezone))
        .fetch_one(pool)
        .await?;
    let stats = AutopilotStats {
        enabled: automations.iter().filter(|a| a.enabled).count(),
        total: automations.len(),
        actions_today,
        pending: runs.iter().filter(|r| r.status == "pending").count(),
        open_tasks: tasks.iter().filter(|t| !t.done).count(),
    };
    Ok(AutopilotSnapshot { automations, runs, tasks, stats, timezone })
}

#[cfg(test)]
mod tests {
    use super::trim_model_text;

    #[test]
    fn trims_quotes_and_whitespace() {
        assert_eq!(trim_model_text("  \"Hello\n\n there.\"  ", 100), "Hello there.");
        assert_eq!(trim_model_text("  \"\"  ", 50), "");
    }

    #[test]
    fn cuts_at_a_sentence_end() {
        let text = "First sentence is here. Second sentence is also here. Third one runs long.";
        assert_eq!(trim_model_text(text, 60), "First sentence is here. Second sentence is also here.");
    }

    #[test]
    fn falls_back_to_an_ellipsis() {
        let out = trim_model_text(&"word ".repeat(100), 40);
        assert!(out.chars().count() <= 40);
        assert!(out.ends_with('…'));
    }
}

/// Concurrency tests for the slot claim. They need a real Postgres, so they
/// only run when VESPER_TEST_DATABASE_URL is set:
///
/// ```text
/// VESPER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db cargo test
/// ```
///
/// Each test creates its own bot and deletes it afterwards. The database's
/// runtime timezone should leave 12:00 UTC outside quiet hours (UTC does).
#[cfg(test)]
mod db_tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    async fn setup() -> Option<PgPool> {
        let url = std::env::var("VESPER_TEST_DATABASE_URL").ok()?;
        let pool = PgPoolOptions::new().max_connections(12).connect(&url).await.expect("connect to VESPER_TEST_DATABASE_URL");
        sqlx::migrate!("./migrations").run(&pool).await.expect("migrate");
        crate::data::ensure_seeded(&pool).await.expect("seed");
        // Open every connection up front, or the first caller finishes its
        // whole cycle before the others connect and no race happens.
        let warm = (0..12).map(|_| sqlx::query("SELECT pg_sleep(0.05)").execute(&pool));
        futures_util::future::join_all(warm).await;
        Some(pool)
    }

    async fn make_bot(pool: &PgPool, daily_limit: i64) -> i32 {
        let handle = format!("race-{}", Utc::now().timestamp_nanos_opt().unwrap_or_default());
        let id: i32 = sqlx::query_scalar("INSERT INTO bots (name, handle, tags) VALUES ('Race Test', $1, '[\"testing\",\"timing\"]') RETURNING id")
            .bind(handle)
            .fetch_one(pool)
            .await
            .unwrap();
        ensure_automations(pool).await.unwrap();
        upsert_automation(
            pool,
            id,
            AutomationPatch {
                enabled: Some(true),
                cadence_minutes: Some(60),
                actions: Some(vec!["journal".into()]),
                daily_limit: Some(daily_limit),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        id
    }

    async fn run_count(pool: &PgPool, bot_id: i32) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM automation_runs WHERE bot_id = $1").bind(bot_id).fetch_one(pool).await.unwrap()
    }

    async fn cleanup(pool: &PgPool, bot_id: i32) {
        sqlx::query("DELETE FROM bots WHERE id = $1").bind(bot_id).execute(pool).await.unwrap();
    }

    fn noon() -> DateTime<Utc> {
        Utc::now().date_naive().and_hms_opt(12, 0, 0).unwrap().and_utc()
    }

    async fn wave(pool: &PgPool, bot_id: i32, at: DateTime<Utc>, force: bool) -> Vec<RunOutcome> {
        let http = reqwest::Client::new();
        let calls = (0..10).map(|_| run_bot_cycle(pool, &http, bot_id, force, Some(at)));
        futures_util::future::join_all(calls).await.into_iter().map(Result::unwrap).collect()
    }

    #[tokio::test]
    async fn ten_parallel_ticks_create_exactly_one_run() {
        let Some(pool) = setup().await else { return };
        let bot = make_bot(&pool, 6).await;
        let outcomes = wave(&pool, bot, noon(), false).await;
        let sent = outcomes.iter().filter(|o| o.status == "sent").count();
        let not_due = outcomes.iter().filter(|o| o.summary == "Not due yet.").count();
        let runs = run_count(&pool, bot).await;
        cleanup(&pool, bot).await;
        assert_eq!((sent, not_due, runs), (1, 9, 1));
    }

    #[tokio::test]
    async fn a_second_wave_inside_the_cadence_does_nothing() {
        let Some(pool) = setup().await else { return };
        let bot = make_bot(&pool, 6).await;
        wave(&pool, bot, noon(), false).await;
        let outcomes = wave(&pool, bot, noon() + chrono::Duration::minutes(59), false).await;
        let runs = run_count(&pool, bot).await;
        cleanup(&pool, bot).await;
        assert!(outcomes.iter().all(|o| o.status == "skipped"));
        assert_eq!(runs, 1);
    }

    #[tokio::test]
    async fn the_daily_limit_holds_across_parallel_waves() {
        let Some(pool) = setup().await else { return };
        let bot = make_bot(&pool, 3).await;
        for step in 0..6 {
            wave(&pool, bot, noon() + chrono::Duration::minutes(61 * step), false).await;
        }
        let runs = run_count(&pool, bot).await;
        cleanup(&pool, bot).await;
        assert_eq!(runs, 3);
    }

    #[tokio::test]
    async fn a_forced_run_skips_the_cadence_but_still_stamps_it() {
        let Some(pool) = setup().await else { return };
        let bot = make_bot(&pool, 6).await;
        let http = reqwest::Client::new();
        run_bot_cycle(&pool, &http, bot, false, Some(noon())).await.unwrap();
        let forced = run_bot_cycle(&pool, &http, bot, true, Some(noon() + chrono::Duration::minutes(1))).await.unwrap();
        let later = run_bot_cycle(&pool, &http, bot, false, Some(noon() + chrono::Duration::minutes(60))).await.unwrap();
        let runs = run_count(&pool, bot).await;
        cleanup(&pool, bot).await;
        assert_eq!(forced.status, "sent");
        assert_eq!(later.summary, "Not due yet.");
        assert_eq!(runs, 2);
    }
}
