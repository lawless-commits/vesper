//! Load-test helper for the chat list.
//!
//! ```text
//! cargo run --release --bin seed_load            seed 200 conversations / 50,000 messages, then time the list
//! cargo run --release --bin seed_load -- --time  only time the list
//! cargo run --release --bin seed_load -- --clean remove everything this tool created
//! ```
//!
//! Reads DATABASE_URL from .env.local / .env. Timing calls GET
//! /api/conversations on a running Vesper (VESPER_URL, default
//! http://127.0.0.1:3000), which runs the same query the /chats page uses.
//! All seeded rows hang off one bot with the handle "load-test", so --clean
//! removes them with a single cascading delete.

use std::time::Instant;

const CONVERSATIONS: i32 = 200;
const MESSAGES: i32 = 50_000;
const HANDLE: &str = "load-test";

async fn time_list() {
    let base = std::env::var("VESPER_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".into());
    let url = format!("{}/api/conversations", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let mut samples = Vec::new();
    let mut count = 0;
    for attempt in 0..6 {
        let started = Instant::now();
        let response = match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => return println!("Could not time {url} (HTTP {}).", r.status()),
            Err(e) => return println!("Could not time {url} ({e}). Start Vesper, or set VESPER_URL."),
        };
        let body: serde_json::Value = response.json().await.unwrap_or_default();
        count = body["conversations"].as_array().map_or(0, Vec::len);
        // The first request warms connections and caches.
        if attempt > 0 {
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
    }
    samples.sort_by(|a, b| a.total_cmp(b));
    println!(
        "list conversations via {url}: {count} conversations, median {:.0} ms, min {:.0} ms, max {:.0} ms (5 warm runs)",
        samples[samples.len() / 2],
        samples[0],
        samples[samples.len() - 1]
    );
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--time") {
        time_list().await;
        return Ok(());
    }

    let url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL is not set. Copy .env.example to .env.local first.")?;
    let pool = sqlx::PgPool::connect(&url).await?;
    sqlx::query("DELETE FROM bots WHERE handle = $1").bind(HANDLE).execute(&pool).await?;
    if args.iter().any(|a| a == "--clean") {
        println!("Removed load-test data.");
        return Ok(());
    }

    let bot_id: i32 = sqlx::query_scalar(
        "INSERT INTO bots (name, handle, tagline, visibility) VALUES ('Load Test', $1, 'Seeded by seed_load', 'private') RETURNING id",
    )
    .bind(HANDLE)
    .fetch_one(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO conversations (bot_id, title, updated_at)
         SELECT $1, 'Load test thread ' || n, now() - (n || ' minutes')::interval FROM generate_series(1, $2) AS n",
    )
    .bind(bot_id)
    .bind(CONVERSATIONS)
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO messages (conversation_id, role, content, engine, created_at)
         SELECT c.id,
                CASE WHEN m % 2 = 0 THEN 'assistant' ELSE 'user' END,
                'Load test message ' || m || ' — ' || repeat('lorem ipsum dolor sit amet ', 8),
                CASE WHEN m % 2 = 0 THEN 'vesper-local' ELSE 'user' END,
                now() - (($3 / $2 - m) || ' seconds')::interval
         FROM (SELECT id FROM conversations WHERE bot_id = $1) AS c
         CROSS JOIN generate_series(1, $3 / $2) AS m",
    )
    .bind(bot_id)
    .bind(CONVERSATIONS)
    .bind(MESSAGES)
    .execute(&pool)
    .await?;
    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM messages").fetch_one(&pool).await?;
    println!("Seeded {CONVERSATIONS} conversations and {MESSAGES} messages (messages table now has {total} rows).");
    time_list().await;
    Ok(())
}
