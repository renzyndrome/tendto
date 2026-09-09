//! The Rust half of sync: how the desktop shell authenticates, and how it uploads local writes.
//!
//! On the desktop the replica is a native SQLite file owned by Rust, so PowerSync's
//! [`BackendConnector`] has to live here too — the alpha Tauri SDK cannot call `connect()` from
//! JavaScript at all. This module is the exact counterpart of `apps/web/src/lib/powersync/
//! client.ts` and `apps/web/src/lib/auth/token.ts`, and it must keep the same two promises:
//!
//!   1. **Every write goes up through FastAPI** (`POST /sync/upload`), never straight to Postgres.
//!   2. **A transaction is only completed once the API has accepted it.** Anything else silently
//!      drops a user's offline edits — returning `Err` instead leaves the queue intact and
//!      PowerSync retries with backoff.
//!
//! Token handling mirrors `token.ts`: the long-lived *session* token (from `SessionStore`) is
//! exchanged for a short-lived JWT, which is cached until a minute before it expires. The same
//! JWT authenticates both the sync stream and the upload call.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::Engine;
use powersync::error::PowerSyncError;
use powersync::{BackendConnector, CrudEntry, PowerSyncCredentials, PowerSyncDatabase, UpdateType};
use serde::Serialize;
use serde_json::{Map, Value};
use tokio::sync::Mutex;

use crate::session::SessionStore;

/// Refresh this long before `exp`, so a token never expires mid-request. Matches
/// REFRESH_WINDOW_SECONDS in apps/web/src/lib/auth/token.ts.
const REFRESH_WINDOW: Duration = Duration::from_secs(60);

/// Give up on a stalled request rather than waiting forever.
///
/// This is not politeness, it is a deadlock guard. `jwt()` holds its lock across the token
/// exchange to collapse concurrent callers, and PowerSync awaits `upload_data` with no timeout of
/// its own — so a server that accepts a connection and never answers would wedge BOTH the sync
/// stream and the upload queue permanently, looking exactly like "offline" with no recovery short
/// of restarting the app. A timeout turns that into an ordinary retry.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The service URLs. Passed in from JavaScript at connect time rather than compiled in, so the
/// bundle stays the single source of truth for which backend this build talks to.
///
/// `rename_all` matters: Tauri converts command ARGUMENT names from camelCase, but the fields
/// inside a struct argument are plain serde. Without this the deserialize fails and `connect`
/// returns an error that is easy to mistake for "still offline".
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Urls {
    pub auth_url: String,
    pub api_url: String,
    pub powersync_url: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ConnectorError {
    #[error("not signed in")]
    NoSession,
    #[error("the auth service rejected the session (HTTP {status})")]
    SessionRejected { status: u16 },
    #[error("the auth service returned no token")]
    NoToken,
    #[error("upload rejected by the API (HTTP {status}): {body}")]
    UploadRejected { status: u16, body: String },
    #[error(transparent)]
    Http(#[from] reqwest::Error),
}

impl From<ConnectorError> for PowerSyncError {
    fn from(error: ConnectorError) -> Self {
        PowerSyncError::upload_error(error)
    }
}

#[derive(Clone)]
struct CachedJwt {
    token: String,
    /// Unix seconds. 0 when the token carried no readable `exp` — treated as always stale.
    expires_at: u64,
}

/// One CRUD row as `POST /sync/upload` expects it. Mirrors `SyncEntry` in
/// apps/api/app/schemas/sync.py; the field names are the wire contract.
#[derive(Debug, Serialize, PartialEq, Eq)]
struct UploadEntry {
    op: &'static str,
    table: String,
    id: String,
    data: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct UploadBody {
    entries: Vec<UploadEntry>,
}

/// The wire name for a change.
///
/// Spelled out rather than serialising [`UpdateType`] directly: the API's `Op` enum only accepts
/// these three strings, and an upstream rename in an alpha crate would otherwise turn every
/// upload into a silent 422 that looks like a sync outage.
fn op_name(update_type: &UpdateType) -> &'static str {
    match update_type {
        UpdateType::Put => "PUT",
        UpdateType::Patch => "PATCH",
        UpdateType::Delete => "DELETE",
    }
}

/// Convert one transaction's CRUD entries into the request body.
///
/// Kept free of I/O so the wire shape can be tested without a database or a server.
fn build_upload_body(entries: Vec<CrudEntry>) -> UploadBody {
    UploadBody {
        entries: entries
            .into_iter()
            .map(|entry| UploadEntry {
                op: op_name(&entry.update_type),
                table: entry.table,
                id: entry.id,
                // DELETE carries no data; the API expects an explicit null, matching the web
                // client's `opData ?? null`.
                data: entry.data,
            })
            .collect(),
    }
}

/// Read the `exp` claim out of a JWT without verifying it.
///
/// Verification is the server's job (FastAPI and PowerSync both check the signature against
/// JWKS). All this needs is "when should I fetch a new one", and an unreadable token is reported
/// as already expired so the next call refetches rather than trusting it.
fn jwt_expiry(token: &str) -> u64 {
    let Some(payload) = token.split('.').nth(1) else {
        return 0;
    };
    let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload) else {
        return 0;
    };
    let Ok(claims) = serde_json::from_slice::<Value>(&bytes) else {
        return 0;
    };
    claims.get("exp").and_then(Value::as_u64).unwrap_or(0)
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// TendTo's backend connector: better-auth for credentials, FastAPI for writes.
pub struct TendToConnector {
    db: PowerSyncDatabase,
    session: std::sync::Arc<SessionStore>,
    urls: Urls,
    http: reqwest::Client,
    jwt: Mutex<Option<CachedJwt>>,
}

impl TendToConnector {
    pub fn new(db: PowerSyncDatabase, session: std::sync::Arc<SessionStore>, urls: Urls) -> Self {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            // Only fails if the TLS backend cannot start, which is fatal for sync either way.
            .unwrap_or_else(|error| {
                log::error!("falling back to a client with no timeout: {error}");
                reqwest::Client::new()
            });
        Self {
            db,
            session,
            urls,
            http,
            jwt: Mutex::new(None),
        }
    }

    /// A JWT that is valid now, minting a fresh one when the cached one is close to expiring.
    ///
    /// The lock is held across the request on purpose: it collapses a burst of concurrent callers
    /// (the sync stream and an upload, typically) into one exchange, the way `getAuthToken`'s
    /// in-flight promise does on the web.
    async fn jwt(&self) -> Result<String, ConnectorError> {
        let mut cached = self.jwt.lock().await;
        if let Some(entry) = cached.as_ref() {
            if entry.expires_at > now_seconds() + REFRESH_WINDOW.as_secs() {
                return Ok(entry.token.clone());
            }
        }

        let session = self.session.get().ok_or(ConnectorError::NoSession)?;
        let response = self
            .http
            .get(format!("{}/api/auth/token", self.urls.auth_url))
            .bearer_auth(session)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            // The session is gone or revoked; drop it so we stop replaying a dead credential.
            *cached = None;
            return Err(ConnectorError::SessionRejected { status });
        }

        #[derive(serde::Deserialize)]
        struct TokenResponse {
            token: Option<String>,
        }
        let token = response
            .json::<TokenResponse>()
            .await?
            .token
            .filter(|token| !token.is_empty())
            .ok_or(ConnectorError::NoToken)?;

        *cached = Some(CachedJwt {
            expires_at: jwt_expiry(&token),
            token: token.clone(),
        });
        Ok(token)
    }

    /// Drop the cached JWT so the next call mints a new one.
    async fn invalidate_jwt(&self) {
        *self.jwt.lock().await = None;
    }
}

#[async_trait]
impl BackendConnector for TendToConnector {
    async fn fetch_credentials(&self) -> Result<PowerSyncCredentials, PowerSyncError> {
        Ok(PowerSyncCredentials {
            endpoint: self.urls.powersync_url.clone(),
            token: self.jwt().await?,
        })
    }

    async fn upload_data(&self) -> Result<(), PowerSyncError> {
        // One transaction at a time, completed only after the API accepts it. `next_crud_transaction`
        // always returns the oldest incomplete transaction, so this drains the queue in order.
        while let Some(mut transaction) = self.db.next_crud_transaction().await? {
            // `take` leaves the transaction whole (an empty Vec behind), so `complete()` can
            // still consume it below. Moving the field out would partially move `transaction`.
            let body = build_upload_body(std::mem::take(&mut transaction.crud));
            let response = self
                .http
                .post(format!("{}/sync/upload", self.urls.api_url))
                .bearer_auth(self.jwt().await?)
                .json(&body)
                .send()
                .await?;

            if response.status() == reqwest::StatusCode::UNAUTHORIZED {
                // The JWT expired between minting and use; force a new one and let PowerSync retry.
                self.invalidate_jwt().await;
            }

            if !response.status().is_success() {
                let status = response.status().as_u16();
                let body = response.text().await.unwrap_or_default();
                // Deliberately NOT completing the transaction: the writes stay queued and are
                // retried, which is the whole point of an offline-first upload queue.
                return Err(ConnectorError::UploadRejected { status, body }.into());
            }

            transaction.complete().await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(update_type: UpdateType, data: Option<Map<String, Value>>) -> CrudEntry {
        CrudEntry {
            client_id: 1,
            transaction_id: 1,
            update_type,
            table: "pages".into(),
            id: "page-1".into(),
            metadata: None,
            data,
            previous_values: None,
        }
    }

    fn some_data() -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("title".into(), Value::String("Hello".into()));
        map
    }

    #[test]
    fn ops_use_the_names_the_api_accepts() {
        assert_eq!(op_name(&UpdateType::Put), "PUT");
        assert_eq!(op_name(&UpdateType::Patch), "PATCH");
        assert_eq!(op_name(&UpdateType::Delete), "DELETE");
    }

    #[test]
    fn the_body_matches_the_api_contract() {
        let body = build_upload_body(vec![entry(UpdateType::Put, Some(some_data()))]);
        let json = serde_json::to_value(&body).expect("serialize");
        assert_eq!(
            json,
            serde_json::json!({
                "entries": [
                    { "op": "PUT", "table": "pages", "id": "page-1", "data": { "title": "Hello" } }
                ]
            }),
            "field names are the wire contract with apps/api/app/schemas/sync.py"
        );
    }

    #[test]
    fn a_delete_sends_an_explicit_null_data() {
        let body = build_upload_body(vec![entry(UpdateType::Delete, None)]);
        let json = serde_json::to_value(&body).expect("serialize");
        assert_eq!(json["entries"][0]["data"], Value::Null);
        assert_eq!(json["entries"][0]["op"], "DELETE");
    }

    #[test]
    fn every_entry_in_a_transaction_is_uploaded_in_order() {
        let body = build_upload_body(vec![
            entry(UpdateType::Put, Some(some_data())),
            entry(UpdateType::Patch, Some(some_data())),
            entry(UpdateType::Delete, None),
        ]);
        let ops: Vec<_> = body.entries.iter().map(|entry| entry.op).collect();
        assert_eq!(ops, vec!["PUT", "PATCH", "DELETE"]);
    }

    #[test]
    fn jwt_expiry_is_read_from_the_payload() {
        // {"exp":1893456000} base64url, no padding — a real token's middle segment.
        let payload =
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"exp":1893456000}"#);
        assert_eq!(
            jwt_expiry(&format!("header.{payload}.signature")),
            1893456000
        );
    }

    #[test]
    fn an_unreadable_jwt_counts_as_expired() {
        // Anything we cannot read must refresh rather than be trusted.
        assert_eq!(jwt_expiry(""), 0);
        assert_eq!(jwt_expiry("not-a-jwt"), 0);
        assert_eq!(jwt_expiry("header.$$$.signature"), 0);
        let no_exp = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"sub":"user"}"#);
        assert_eq!(jwt_expiry(&format!("header.{no_exp}.sig")), 0);
    }
}
