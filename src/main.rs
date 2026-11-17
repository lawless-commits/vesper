//! Vesper: a local-first AI companion studio.
//!
//! One binary: an axum web server that renders every page as HTML, serves a
//! JSON API under /api, and stores everything in Postgres.

mod api;
mod autopilot;
mod avatar;
mod capabilities;
mod data;
mod http;
mod icons;
mod models;
mod pages;
mod persona;
mod runtime;
mod timezone;
mod util;
mod validate;
mod views;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use axum::extract::Query;
use axum::http::{HeaderValue, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use sqlx::postgres::PgPoolOptions;

use crate::http::{AppState, Settings, require_password};

const APP_CSS: &str = include_str!("../static/app.css");
const APP_JS: &str = include_str!("../static/app.js");
const ICON_SVG: &str = include_str!("../static/icon.svg");

fn asset(content_type: &'static str, body: &'static str) -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, content_type), (header::CACHE_CONTROL, "public, max-age=300")],
        body,
    )
}

#[derive(serde::Deserialize)]
struct AvatarQuery {
    seed: Option<String>,
    preset: Option<String>,
}

async fn avatar_svg(Query(query): Query<AvatarQuery>) -> impl IntoResponse {
    let seed: String = query.seed.unwrap_or_default().chars().take(120).collect();
    let svg = avatar::glyph_svg(&seed, query.preset.as_deref());
    (
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("image/svg+xml")),
            // Deterministic from the query, so it can be cached for a long time.
            (header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable")),
        ],
        svg,
    )
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(api::health))
        .route("/bots", get(api::list_bots).post(api::create_bot).patch(api::update_bot))
        .route("/bots/{id}", get(api::get_bot).delete(api::delete_bot))
        .route("/studio/draft", post(api::draft))
        .route("/conversations", get(api::list_conversations).post(api::create_conversation))
        .route(
            "/conversations/{id}",
            get(api::get_conversation).patch(api::rename_conversation).delete(api::delete_conversation),
        )
        .route("/chat", post(api::chat))
        .route("/runtime", get(api::get_runtime).put(api::update_runtime))
        .route("/runtime/test", post(api::test_runtime))
        .route("/automation", get(api::automation_snapshot).put(api::update_automation))
        .route("/automation/run", post(api::run_automation))
        .route("/automation/runs", axum::routing::patch(api::decide_run))
        .route("/tasks", post(api::create_task).patch(api::update_task))
        .fallback(|| async { http::not_found("Not found") });

    Router::new()
        .route("/", get(pages::discover))
        .route("/chats", get(pages::chats))
        .route("/chats/{id}", get(pages::chat))
        .route("/bots/{handle}", get(pages::bot_profile))
        .route("/studio", get(pages::studio))
        .route("/studio/{id}", get(pages::studio_edit))
        .route("/runtime", get(pages::runtime))
        .route("/autopilot", get(pages::autopilot))
        .route("/capabilities", get(pages::capabilities))
        .route("/static/app.css", get(|| async { asset("text/css; charset=utf-8", APP_CSS) }))
        .route("/static/app.js", get(|| async { asset("text/javascript; charset=utf-8", APP_JS) }))
        .route("/icon.svg", get(|| async { asset("image/svg+xml", ICON_SVG) }))
        .route("/avatar.svg", get(avatar_svg))
        .nest("/api", api)
        .fallback(pages::not_found)
        .layer(axum::middleware::from_fn_with_state(state.clone(), require_password))
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Same files and priority as before: .env.local, then .env.
    let _ = dotenvy::from_filename(".env.local");
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "vesper=info,warn".into()),
        )
        .init();

    let Ok(database_url) = std::env::var("DATABASE_URL") else {
        eprintln!(
            "DATABASE_URL is not set. Copy .env.example to .env.local, set DATABASE_URL to your Postgres \
             connection string, then run `cargo run` again. See README.md."
        );
        std::process::exit(1);
    };
    let pool = PgPoolOptions::new().max_connections(10).connect(&database_url).await.map_err(|error| {
        format!("Could not connect to Postgres at DATABASE_URL: {error}")
    })?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = AppState {
        pool,
        http: reqwest::Client::builder().build()?,
        settings: Arc::new(Settings::from_env()),
    };

    // Single-user app: listen on localhost only unless HOST says otherwise.
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    let address: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!("Vesper is running at http://{address}");
    if state.settings.password.is_some() {
        tracing::info!("VESPER_PASSWORD is set: every page requires HTTP Basic auth.");
    }
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
