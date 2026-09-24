//! Run the user's own coding-agent CLI, on this machine, for this user's own request.
//!
//! Why here and not on the server: `apps/api/app/ai/provider.py` can already shell out to
//! `claude` or `codex`, but that path is marked dev/self-host only, and both reasons are about
//! the SERVER — one person's subscription must not serve other people's requests, and an
//! agentic CLI should not run on a shared host. Neither objection applies to the binary the
//! user installed and signed into, running on their own machine, over their own text. That is
//! what the vendors' plans cover, and it is why this module exists.
//!
//! The binary is SPAWNED rather than an agent SDK being embedded. That is a billing decision,
//! not a taste one: usage through the installed CLI draws on the subscription, while going
//! through the SDK draws on a separate, pricier credit pool.
//!
//! The containment here is a direct PORT of `CliChatProvider` in the Python file above. Keep
//! the two in step, and change them together:
//!
//!   - the prompt travels over STDIN (argv leaks into `ps` and has length limits),
//!   - the child runs in an EMPTY scratch directory, so its file-reading tools find nothing,
//!   - `claude` gets `--max-turns 1`, so there is no tool-use round trip at all,
//!   - a hard timeout, and
//!   - empty output is an ERROR, never an empty result handed back as if it were real.
//!
//! This matters more here than on the server, not less: the text can come from any page in a
//! shared workspace, which means it can be text a colleague wrote, and the engine reading it is
//! an agent with a shell.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex, Semaphore};
use tokio::time::{timeout, Duration, Instant};

/// Matches `CliChatProvider`'s timeout. Long, because a summary of a full page on a busy laptop
/// is not quick, and a false failure is worse than a slow success.
const TIMEOUT: Duration = Duration::from_secs(120);

/// How much of a failed run's stderr is carried back. Host paths and config end up in here,
/// which is acceptable only because it never leaves the user's own machine.
const STDERR_DETAIL: usize = 500;

/// Emitted per piece of generated text. The client shows these as they arrive; the finished
/// text is the command's RETURN value, so a lost delta costs a flicker, not the answer.
const DELTA_EVENT: &str = "ai://delta";

/// What a cancelled run reports. The client aborted it on purpose, so it discards this.
const CANCELLED: &str = "Cancelled.";

/// One known CLI, its argv, and the extra argv that makes it stream.
struct CliSpec {
    /// The name the client stores and sends back. Matches the server's engine names.
    kind: &'static str,
    label: &'static str,
    binary: &'static str,
    args: &'static [&'static str],
    /// Empty when the CLI cannot stream; its whole reply then arrives as one piece.
    stream_args: &'static [&'static str],
    /// Whether this CLI's argv and its containment have been checked against a real install.
    /// An unverified engine is offered but never chosen by default: picking an agentic CLI
    /// nobody has tested, to read text a colleague wrote, should be a decision.
    verified: bool,
}

/// Verified against `CliChatProvider`, which smoke-tested these shapes against a real install.
///
/// `claude` needs `--include-partial-messages` as well as `--output-format stream-json`: without
/// it the CLI emits one event at the end and streaming buys nothing. `--verbose` is required
/// alongside stream-json under `-p`.
///
/// `codex exec` is UNVERIFIED — no install has ever been tested here. It is detected and offered,
/// never chosen by default, and the settings row says so. It does not stream.
///
/// `--sandbox read-only` is its containment, standing in for `--max-turns 1`, which it has no
/// equivalent of. `codex exec` is read-only by default already, so this is belt and braces: it
/// blocks file writes and network access, and if the flag were ever wrong the CLI would exit
/// non-zero rather than run unconstrained. That is the right way round for a guess.
const CLIS: &[CliSpec] = &[
    CliSpec {
        kind: "claude-cli",
        label: "Claude CLI",
        binary: "claude",
        args: &["-p", "--max-turns", "1"],
        stream_args: &[
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--verbose",
        ],
        verified: true,
    },
    CliSpec {
        kind: "codex-cli",
        label: "Codex CLI",
        binary: "codex",
        args: &[
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "-",
        ],
        stream_args: &[],
        verified: false,
    },
];

fn spec_for(kind: &str) -> Option<&'static CliSpec> {
    CLIS.iter().find(|spec| spec.kind == kind)
}

/// Resolved binary paths and live runs.
///
/// Resolution is cached because it can cost a login-shell spawn (see `locate`), and the answer
/// does not change while the app is open.
pub struct AiState {
    resolved: Mutex<HashMap<&'static str, Option<PathBuf>>>,
    running: Mutex<HashMap<String, oneshot::Sender<()>>>,
    /// One CLI at a time. Each run is a real agent process, so a burst of clicks must not
    /// become a burst of them.
    slot: Semaphore,
}

impl Default for AiState {
    fn default() -> Self {
        Self {
            resolved: Mutex::new(HashMap::new()),
            running: Mutex::new(HashMap::new()),
            slot: Semaphore::new(1),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Delta<'a> {
    run_id: &'a str,
    text: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEngine {
    kind: String,
    label: String,
    /// The absolute path that was found. Shown in settings, because "found" and "found the one
    /// you meant" are different things when several installs exist.
    binary: String,
    /// False for an engine nobody has run here. The client refuses to default to one.
    verified: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    engines: Vec<LocalEngine>,
    /// Every binary name that was probed, found or not. Returned rather than hard-coded in the
    /// client so the settings row cannot claim to have looked for something this file does not.
    looked_for: Vec<String>,
}

/// Which coding-agent CLIs exist on this machine.
#[tauri::command]
pub async fn ai_detect(state: State<'_, AiState>) -> Result<Detection, String> {
    let mut engines = Vec::new();
    for spec in CLIS {
        if let Some(path) = resolve(state.inner(), spec).await {
            engines.push(LocalEngine {
                kind: spec.kind.to_string(),
                label: spec.label.to_string(),
                binary: path.to_string_lossy().into_owned(),
                verified: spec.verified,
            });
        }
    }
    Ok(Detection {
        engines,
        looked_for: CLIS.iter().map(|spec| spec.binary.to_string()).collect(),
    })
}

/// Run one task and return the finished text, emitting `ai://delta` as it is written.
///
/// The finished text is the RETURN value rather than a `done` event, so there is no ordering
/// race between the last delta and the end of the run, and one failed IPC frame cannot turn a
/// good answer into a hang.
#[tauri::command]
pub async fn ai_run<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AiState>,
    run_id: String,
    kind: String,
    system: String,
    user: String,
) -> Result<String, String> {
    let (sender, mut cancel) = oneshot::channel();
    state.running.lock().await.insert(run_id.clone(), sender);

    let outcome = run_cli(
        &app,
        state.inner(),
        &run_id,
        &kind,
        &system,
        &user,
        &mut cancel,
    )
    .await;

    state.running.lock().await.remove(&run_id);
    outcome
}

/// Stop a run that is still going. A no-op once it has finished.
#[tauri::command]
pub async fn ai_cancel(state: State<'_, AiState>, run_id: String) -> Result<(), String> {
    if let Some(sender) = state.running.lock().await.remove(&run_id) {
        // The receiver is gone only if the run ended in the meantime, which is the same
        // outcome the caller wanted.
        let _ = sender.send(());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_cli<R: Runtime>(
    app: &AppHandle<R>,
    state: &AiState,
    run_id: &str,
    kind: &str,
    system: &str,
    user: &str,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<String, String> {
    let spec = spec_for(kind).ok_or_else(|| format!("Unknown AI engine '{kind}'."))?;
    let binary = resolve(state, spec)
        .await
        .ok_or_else(|| format!("{} not found on PATH or in a login shell.", spec.binary))?;

    let _permit = tokio::select! {
        permit = state.slot.acquire() => permit.map_err(|_| "AI engine unavailable.".to_string())?,
        _ = &mut *cancel => return Err(CANCELLED.to_string()),
    };

    // Removed when this function returns, on every path including the early ones.
    let scratch = tempfile::Builder::new()
        .prefix("tendto-ai-")
        .tempdir()
        .map_err(|error| format!("Scratch directory failed: {error}"))?;

    // Every part is a literal from CLIS: nothing from the webview reaches the argument list.
    // The prompt, which is the part that can carry a colleague's page content, goes over stdin.
    let argv: Vec<&str> = spec
        .args
        .iter()
        .chain(spec.stream_args.iter())
        .copied()
        .collect();

    let mut child = Command::new(&binary)
        .args(&argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(scratch.path())
        // The window closing mid-run must not leave an agent running on someone's machine.
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("{} failed to start: {error}", spec.binary))?;

    let mut stdin = child.stdin.take().ok_or("Engine stdin unavailable.")?;
    let prompt = prompt(system, user);
    // Written from its own task rather than inline: a prompt larger than the pipe buffer would
    // otherwise block here while the child blocks writing output nobody is reading yet.
    let writing = tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        // Dropping closes the pipe, which is what tells the CLI the prompt is complete.
    });

    let mut stderr = child.stderr.take().ok_or("Engine stderr unavailable.")?;
    // Drained concurrently for the same reason: a chatty CLI that fills its stderr pipe while
    // nobody reads it stops writing stdout as well, and the run hangs until the timeout.
    let errors = tokio::spawn(async move {
        let mut buffer = String::new();
        let _ = stderr.read_to_string(&mut buffer).await;
        buffer
    });

    let stdout = child.stdout.take().ok_or("Engine stdout unavailable.")?;
    let mut lines = BufReader::new(stdout).lines();
    let streaming = !spec.stream_args.is_empty();
    let deadline = Instant::now() + TIMEOUT;
    let mut text = String::new();

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let _ = child.start_kill();
            return Err(timed_out(spec));
        }
        let next = tokio::select! {
            read = timeout(remaining, lines.next_line()) => read,
            _ = &mut *cancel => {
                let _ = child.start_kill();
                return Err(CANCELLED.to_string());
            }
        };
        let line = match next {
            Err(_) => {
                let _ = child.start_kill();
                return Err(timed_out(spec));
            }
            Ok(Err(error)) => {
                let _ = child.start_kill();
                return Err(format!("{} output could not be read: {error}", spec.binary));
            }
            Ok(Ok(None)) => break,
            Ok(Ok(Some(line))) => line,
        };

        // A non-streaming CLI prints its answer as plain lines; a streaming one prints JSON
        // events, of which only the text deltas are ours.
        let piece = if streaming {
            cli_delta(&line)
        } else {
            Some(format!("{line}\n"))
        };
        let Some(piece) = piece.filter(|piece| !piece.is_empty()) else {
            continue;
        };
        text.push_str(&piece);
        let _ = app.emit(
            DELTA_EVENT,
            Delta {
                run_id,
                text: &piece,
            },
        );
    }

    let remaining = deadline.saturating_duration_since(Instant::now());
    let status = match timeout(remaining, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => return Err(format!("{} could not be waited on: {error}", spec.binary)),
        Err(_) => {
            let _ = child.start_kill();
            return Err(timed_out(spec));
        }
    };
    let _ = writing.await;
    let stderr_text = errors.await.unwrap_or_default();

    if !status.success() {
        let detail: String = stderr_text.trim().chars().take(STDERR_DETAIL).collect();
        let code = status.code().unwrap_or(-1);
        return Err(format!("{} exited {code}. {detail}", spec.binary)
            .trim_end()
            .to_string());
    }

    let text = text.trim().to_string();
    if text.is_empty() {
        // Never hand back an empty answer as if it were real: it would silently replace a
        // paragraph with nothing.
        return Err(format!("{} returned no output.", spec.binary));
    }
    Ok(text)
}

fn timed_out(spec: &CliSpec) -> String {
    format!("{} timed out after {}s.", spec.binary, TIMEOUT.as_secs())
}

/// System first, then the user's text, in one stdin document.
///
/// `-p` mode takes a single prompt, and keeping the static instructions first preserves their
/// priority over the content embedded below them. Identical to `CliChatProvider`.
fn prompt(system: &str, user: &str) -> String {
    format!("{system}\n\n---\n\n{user}\n")
}

/// The text of one `content_block_delta` line, or None for every other kind of line.
///
/// The shape, verified rather than guessed:
/// ```json
/// {"type":"stream_event","event":{"type":"content_block_delta",
///  "delta":{"type":"text_delta","text":"..."}}}
/// ```
/// Session lines, hook lifecycle and rate-limit notices all share the stream. Anything
/// unparseable is SKIPPED rather than failing the run: one odd line must not lose a reply that
/// is otherwise arriving fine.
fn cli_delta(line: &str) -> Option<String> {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;
    if event.get("type")?.as_str()? != "stream_event" {
        return None;
    }
    let inner = event.get("event")?;
    if inner.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    let delta = inner.get("delta")?;
    if delta.get("type")?.as_str()? != "text_delta" {
        return None;
    }
    Some(delta.get("text")?.as_str()?.to_string())
}

async fn resolve(state: &AiState, spec: &'static CliSpec) -> Option<PathBuf> {
    if let Some(cached) = state.resolved.lock().await.get(spec.binary) {
        return cached.clone();
    }
    let found = locate(spec.binary).await;
    state
        .resolved
        .lock()
        .await
        .insert(spec.binary, found.clone());
    found
}

/// The absolute path to `name`, or None.
///
/// Two attempts, and the SECOND is the one that matters. A GUI app launched from a dock icon or
/// a .desktop entry inherits a bare PATH: none of the shell profile that put `claude` there has
/// run. An nvm install is the common case, and it needs `node` on PATH too, so the answer has to
/// come from a login shell rather than from guessing at directories.
///
/// This is the failure people will report — "it works when I start it from a terminal" — so it
/// is worth the extra process.
async fn locate(name: &str) -> Option<PathBuf> {
    if let Some(path) = on_path(name) {
        return Some(path);
    }
    login_shell_path(name).await
}

fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable(candidate))
}

#[cfg(unix)]
async fn login_shell_path(name: &str) -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    // `name` is always one of the literals in CLIS, never anything that reached us from the
    // webview, so there is nothing here for a quoting bug to let through.
    //
    // `stdin` is NULLED and `kill_on_drop` set, and neither is optional. `Command::output()`
    // pipes only stdout and stderr, so stdin would otherwise be INHERITED: a login shell that
    // blocks on it (an interactive "check for updates" prompt in a profile is the usual
    // culprit) would hang, and dropping the timed-out future does not kill the process. The
    // result would be a detached shell holding the app's stdin forever, plus a false "not
    // found" for a CLI that is installed.
    let output = timeout(
        Duration::from_secs(10),
        Command::new(shell)
            .args(["-l", "-c", &format!("command -v {name}")])
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let found = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let path = PathBuf::from(found);
    is_executable(&path).then_some(path)
}

#[cfg(not(unix))]
async fn login_shell_path(_name: &str) -> Option<PathBuf> {
    // Windows puts installed binaries on the PATH the process already inherits, so there is no
    // profile to source. Nothing to add.
    None
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL_DELTA: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}}"#;

    #[test]
    fn reads_a_text_delta() {
        assert_eq!(cli_delta(REAL_DELTA).as_deref(), Some("Hello"));
    }

    #[test]
    fn skips_every_other_kind_of_line() {
        // Each of these appears on a real `claude` stream, and none of them is our text.
        let ignored = [
            "",
            "not json at all",
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"stream_event","event":{"type":"message_start"}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta"}}}"#,
            "[1, 2, 3]",
        ];
        for line in ignored {
            assert_eq!(cli_delta(line), None, "should have skipped: {line}");
        }
    }

    #[test]
    fn keeps_the_system_prompt_ahead_of_the_user_text() {
        let built = prompt("RULES", "content");
        assert_eq!(built, "RULES\n\n---\n\ncontent\n");
        assert!(built.find("RULES").unwrap() < built.find("content").unwrap());
    }

    #[test]
    fn knows_only_the_engines_in_the_table() {
        assert!(spec_for("claude-cli").is_some());
        assert!(spec_for("codex-cli").is_some());
        assert!(spec_for("anything-else").is_none());
    }

    #[test]
    fn every_engine_is_contained() {
        /*
         * The containment is the point of this module, and it is per-engine. Losing a flag here
         * would let an agentic CLI take tool-use turns over text a colleague wrote in a shared
         * workspace, on someone's own machine. The natural-language injection rule in the system
         * prompt is a request to a model; these flags are the boundary.
         */
        let claude = spec_for("claude-cli").unwrap();
        assert!(
            claude.args.contains(&"--max-turns"),
            "claude lost its turn cap"
        );
        assert!(claude.stream_args.contains(&"--include-partial-messages"));

        // codex has no turn cap to lose, so read-only is its whole boundary.
        let codex = spec_for("codex-cli").unwrap();
        assert!(codex.args.contains(&"--sandbox"), "codex lost its sandbox");
        assert!(
            codex.args.contains(&"read-only"),
            "codex sandbox is not read-only"
        );
        assert!(
            !codex.verified,
            "codex has never been run here; do not mark it verified"
        );
    }

    #[cfg(unix)]
    #[test]
    fn finds_a_binary_on_path_and_ignores_a_non_executable_one() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("claude");
        std::fs::write(&real, "#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o755)).unwrap();

        let plain = dir.path().join("codex");
        std::fs::write(&plain, "not executable").unwrap();
        std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();

        // Scoped to this test's own PATH value; `on_path` reads the variable each call.
        let previous = std::env::var_os("PATH");
        std::env::set_var("PATH", dir.path());
        let found = on_path("claude");
        let missed = on_path("codex");
        match previous {
            Some(value) => std::env::set_var("PATH", value),
            None => std::env::remove_var("PATH"),
        }

        assert_eq!(found.as_deref(), Some(real.as_path()));
        assert_eq!(missed, None, "a non-executable file is not an engine");
    }
}
