//! Sign the user's own `claude` in from the app: `claude auth login`, with its sign-in link shown
//! in the window.
//!
//! The same CLI `ai.rs` runs, on the same machine, for the same person. This does only what
//! typing `claude auth login` in a terminal does, so someone without a terminal habit can still
//! put their own subscription to work. It never runs on the server: a server's `claude` is one
//! account for everyone, and signing it in from a browser would let any user take it over.
//!
//! Three rules, all about what the webview can make Rust do:
//!
//!   - argv is literal (`auth login`, `auth status --json`). Nothing from the webview reaches it.
//!   - The only link the app ever opens is one the CLI itself printed, over https, on a Claude or
//!     Anthropic host. The webview cannot hand Rust a URL to open, and is never TOLD the link
//!     either: with it, a compromised page could send the link elsewhere, have it authorized
//!     with a stranger's account, and paste that code back, signing this machine's `claude`
//!     into an account that would then read the user's notes. Rust holds it and opens it.
//!   - The one piece of text the webview sends is the code a sign-in page may show. It goes to
//!     the CLI's stdin after a shape check, as a single line.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{sleep_until, timeout, Duration, Instant};

use crate::ai::{claude_binary, AiState};

/// Emitted with each `LoginEvent`.
const LOGIN_EVENT: &str = "ai://login";

/// Long enough to sign in, find a code in an email, and come back.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);

const STATUS_TIMEOUT: Duration = Duration::from_secs(20);

/// Hosts a sign-in link may point at, or a subdomain of one.
const SIGN_IN_HOSTS: &[&str] = &["claude.ai", "claude.com", "anthropic.com"];

const MAX_CODE: usize = 500;

/// A code write that takes longer than this means the CLI is not reading its input.
const CODE_WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// One browser tab per click, not one per call in a loop.
const OPEN_COOLDOWN: Duration = Duration::from_secs(3);

/// Longest line of CLI output read as one. Longer output is read in pieces of this size.
const MAX_LINE: u64 = 8 * 1024;

/// How many of the CLI's last lines a failed sign-in carries back, and how long they may be.
const TAIL_LINES: usize = 6;
const TAIL_CHARS: usize = 300;

static NEXT_RUN: AtomicU64 = AtomicU64::new(1);

/// The sign-in in progress, if any. One at a time: starting again replaces it.
#[derive(Default)]
pub struct LoginState {
    run: Arc<Mutex<Option<LoginRun>>>,
}

struct LoginRun {
    /// Tells a finished run's cleanup apart from a newer run that replaced it.
    id: u64,
    stdin: Option<ChildStdin>,
    cancel: Option<oneshot::Sender<()>>,
    /// The sign-in link the CLI printed, once it has. The only URL `ai_login_open` will open.
    link: Option<String>,
    last_open: Option<Instant>,
}

/// What the webview hears. Deliberately without the link itself; see the module note.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LoginEvent {
    /// The CLI printed its sign-in link: "Open sign-in page" can work now.
    Link,
    /// The sign-in ended. `ok` is read from `claude auth status`, not guessed from the exit code.
    Done { ok: bool, message: String },
}

/// What `watch_login` reports to its owner, which keeps the link and tells the webview the rest.
#[derive(Debug, PartialEq)]
enum Watched {
    Link(String),
    Done { ok: bool, message: String },
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    found: bool,
    logged_in: bool,
    email: Option<String>,
    subscription: Option<String>,
}

/// Whether `claude` is installed here, and signed in.
#[tauri::command]
pub async fn ai_login_status(ai: State<'_, AiState>) -> Result<LoginStatus, String> {
    match claude_binary(ai.inner()).await {
        Some(binary) => Ok(read_status(&binary).await),
        None => Ok(LoginStatus::default()),
    }
}

/// Start `claude auth login`. Progress arrives as `ai://login` events.
#[tauri::command]
pub async fn ai_login_start<R: Runtime>(
    app: AppHandle<R>,
    ai: State<'_, AiState>,
    login: State<'_, LoginState>,
) -> Result<(), String> {
    let binary = claude_binary(ai.inner())
        .await
        .ok_or("claude not found on PATH or in a login shell.")?;

    let mut slot = login.run.lock().await;
    // A second click starts over rather than running two sign-ins side by side.
    if let Some(cancel) = slot.take().and_then(|previous| previous.cancel) {
        let _ = cancel.send(());
    }

    let mut child = cli(&binary)
        .args(["auth", "login"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("claude failed to start: {error}"))?;
    let (cancel, cancelled) = oneshot::channel();
    let id = NEXT_RUN.fetch_add(1, Ordering::Relaxed);
    *slot = Some(LoginRun {
        id,
        stdin: child.stdin.take(),
        cancel: Some(cancel),
        link: None,
        last_open: None,
    });
    drop(slot);

    let shared = Arc::clone(&login.run);
    tokio::spawn(async move {
        let (events, mut received) = mpsc::unbounded_channel();
        let watching = tokio::spawn(watch_login(child, cancelled, binary, events));
        while let Some(watched) = received.recv().await {
            let event = {
                let mut slot = shared.lock().await;
                // A run replaced by a newer one says nothing more: its "cancelled" would arrive
                // after the new run's link and end the new run on screen.
                if slot.as_ref().map(|run| run.id) != Some(id) {
                    continue;
                }
                match watched {
                    Watched::Link(url) => {
                        if let Some(run) = slot.as_mut() {
                            run.link = Some(url);
                        }
                        LoginEvent::Link
                    }
                    Watched::Done { ok, message } => {
                        *slot = None;
                        LoginEvent::Done { ok, message }
                    }
                }
            };
            let _ = app.emit(LOGIN_EVENT, event);
        }
        let _ = watching.await;
    });
    Ok(())
}

/// Hand the CLI the code a sign-in page showed, when the page shows one.
#[tauri::command]
pub async fn ai_login_code(login: State<'_, LoginState>, code: String) -> Result<(), String> {
    let line = format!(
        "{}\n",
        valid_code(&code).ok_or("Code invalid. Paste it exactly as shown.")?
    );
    // Taken out, so the lock is not held while writing: a CLI that is not reading would
    // otherwise stall Cancel and Open behind it.
    let (id, mut stdin) = {
        let mut slot = login.run.lock().await;
        let run = slot.as_mut().ok_or("No sign-in running.")?;
        let stdin = run.stdin.take().ok_or("Sign-in not accepting a code.")?;
        (run.id, stdin)
    };
    let written = timeout(CODE_WRITE_TIMEOUT, async {
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await
    })
    .await;
    // Back in place for another try, unless the run ended or was replaced meanwhile.
    if let Some(run) = login.run.lock().await.as_mut().filter(|run| run.id == id) {
        run.stdin = Some(stdin);
    }
    match written {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(format!("Code not sent: {error}")),
        Err(_) => Err("Code not sent. Sign-in not reading it.".to_string()),
    }
}

/// Open the sign-in link the CLI printed, in the system browser. Takes no URL from the webview.
#[tauri::command]
pub async fn ai_login_open(login: State<'_, LoginState>) -> Result<(), String> {
    let link = {
        let mut slot = login.run.lock().await;
        let run = slot.as_mut().ok_or("No sign-in running.")?;
        let link = run.link.clone().ok_or("No sign-in link yet.")?;
        if run.last_open.is_some_and(|at| at.elapsed() < OPEN_COOLDOWN) {
            return Ok(());
        }
        run.last_open = Some(Instant::now());
        link
    };
    // Only a link that passed this check is ever stored. Checked again here anyway, since this
    // is the line that hands it to the operating system.
    let link = sign_in_link(&link).ok_or("Sign-in link refused.")?;
    let mut child = opener(&link)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Browser not opened: {error}"))?;
    // Reaped in the background, so the opener does not linger as a zombie.
    tokio::spawn(async move {
        let _ = child.wait().await;
    });
    Ok(())
}

/// Stop the sign-in in progress. A no-op when there is none.
#[tauri::command]
pub async fn ai_login_cancel(login: State<'_, LoginState>) -> Result<(), String> {
    if let Some(cancel) = login
        .run
        .lock()
        .await
        .as_mut()
        .and_then(|run| run.cancel.take())
    {
        let _ = cancel.send(());
    }
    Ok(())
}

enum Ended {
    Exited,
    Cancelled,
    TimedOut,
}

/// Read the CLI's output until it ends, sending the sign-in link once and `Done` exactly once.
///
/// The child's stdin must already be taken out (`ai_login_start` keeps it for the code):
/// `Child::wait` closes a stdin it still holds, and the CLI would read end-of-input and exit.
async fn watch_login(
    mut child: Child,
    mut cancelled: oneshot::Receiver<()>,
    binary: PathBuf,
    events: mpsc::UnboundedSender<Watched>,
) {
    let (lines_in, mut lines) = mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        forward_lines(stdout, lines_in.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        forward_lines(stderr, lines_in.clone());
    }
    drop(lines_in);

    let deadline = Instant::now() + LOGIN_TIMEOUT;
    let mut seen = Seen::default();
    let mut streams_open = true;
    let ended = loop {
        tokio::select! {
            line = lines.recv(), if streams_open => match line {
                Some(line) => seen.take(&line, &events),
                None => streams_open = false,
            },
            _ = child.wait() => break Ended::Exited,
            _ = &mut cancelled => break Ended::Cancelled,
            _ = sleep_until(deadline) => break Ended::TimedOut,
        }
    };

    let done = match ended {
        Ended::Cancelled => {
            let _ = child.kill().await;
            Watched::Done {
                ok: false,
                message: "Sign-in cancelled.".to_string(),
            }
        }
        Ended::TimedOut => {
            let _ = child.kill().await;
            Watched::Done {
                ok: false,
                message: "Sign-in timed out. Retry.".to_string(),
            }
        }
        Ended::Exited => {
            // The last lines can still be in flight when the process ends.
            while let Ok(Some(line)) = timeout(Duration::from_millis(500), lines.recv()).await {
                seen.take(&line, &events);
            }
            if read_status(&binary).await.logged_in {
                Watched::Done {
                    ok: true,
                    message: "Signed in.".to_string(),
                }
            } else {
                Watched::Done {
                    ok: false,
                    message: format!("Sign-in not finished. {}", seen.tail())
                        .trim_end()
                        .to_string(),
                }
            }
        }
    };
    let _ = events.send(done);
}

/// What the CLI has printed so far: whether the link went out, and its last lines.
#[derive(Default)]
struct Seen {
    link_sent: bool,
    tail: VecDeque<String>,
}

impl Seen {
    fn take(&mut self, line: &str, events: &mpsc::UnboundedSender<Watched>) {
        if !self.link_sent {
            if let Some(url) = sign_in_url(line) {
                self.link_sent = true;
                let _ = events.send(Watched::Link(url));
            }
        }
        let plain = strip_ansi(line).trim().to_string();
        if !plain.is_empty() {
            self.tail.push_back(plain);
            if self.tail.len() > TAIL_LINES {
                self.tail.pop_front();
            }
        }
    }

    fn tail(&self) -> String {
        let joined = self.tail.iter().cloned().collect::<Vec<_>>().join(" ");
        joined.chars().take(TAIL_CHARS).collect()
    }
}

/// Each line of `stream`, at most `MAX_LINE` bytes at a time, so a CLI printing one endless line
/// cannot grow a buffer without bound.
fn forward_lines<S>(stream: S, lines: mpsc::UnboundedSender<String>)
where
    S: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut reader = BufReader::new(stream);
        loop {
            let mut buffer = Vec::new();
            match (&mut reader)
                .take(MAX_LINE)
                .read_until(b'\n', &mut buffer)
                .await
            {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buffer)
                        .trim_end_matches(['\n', '\r'])
                        .to_string();
                    if lines.send(line).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

async fn read_status(binary: &Path) -> LoginStatus {
    let output = timeout(
        STATUS_TIMEOUT,
        cli(binary)
            .args(["auth", "status", "--json"])
            .stdin(Stdio::null())
            .output(),
    )
    .await;
    // Read from stdout whatever the exit code: a signed-out CLI may well exit non-zero.
    let parsed = match output {
        Ok(Ok(output)) => parse_status(&output.stdout),
        _ => None,
    };
    parsed.unwrap_or(LoginStatus {
        found: true,
        ..LoginStatus::default()
    })
}

/// `claude auth status --json`, of which only these fields are read.
fn parse_status(stdout: &[u8]) -> Option<LoginStatus> {
    let value: serde_json::Value = serde_json::from_slice(stdout).ok()?;
    let text = |key: &str| value.get(key).and_then(|v| v.as_str()).map(str::to_string);
    Some(LoginStatus {
        found: true,
        logged_in: value.get("loggedIn")?.as_bool()?,
        email: text("email"),
        subscription: text("subscriptionType"),
    })
}

/// A command for the CLI, with the CLI's own directory first on PATH.
///
/// An nvm install's `claude` is a node script, and an app launched from a dock icon has a bare
/// PATH with no `node` on it. nvm puts `node` in the same directory as `claude`.
fn cli(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    if let Some(dir) = binary.parent() {
        let inherited = std::env::var_os("PATH").unwrap_or_default();
        let paths = std::iter::once(dir.to_path_buf()).chain(std::env::split_paths(&inherited));
        if let Ok(joined) = std::env::join_paths(paths) {
            command.env("PATH", joined);
        }
    }
    // Closing the window mid-sign-in must not leave the CLI running.
    command.kill_on_drop(true);
    command
}

/// The system's own "open this URL" command. The URL is an argument, never a shell string.
fn opener(url: &str) -> Command {
    if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(url);
        command
    } else if cfg!(windows) {
        // Not `cmd /c start`: cmd would read the `&` in a query string as a command separator.
        let mut command = Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", url]);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    }
}

/// The first sign-in link in a line of CLI output, in normal form, or None.
///
/// Read from the raw line, so a link inside a terminal hyperlink (OSC 8) is found too: the scan
/// stops at any control character, which is how those sequences end.
fn sign_in_url(line: &str) -> Option<String> {
    let mut rest = line;
    while let Some(start) = rest.find("https://") {
        let candidate: String = rest[start..]
            .chars()
            .take_while(|c| !c.is_whitespace() && !c.is_control() && !"\"'<>`".contains(*c))
            .collect();
        if let Some(link) = sign_in_link(candidate.trim_end_matches(['.', ',', ';', ')', ']'])) {
            return Some(link);
        }
        rest = &rest[start + "https://".len()..];
    }
    None
}

/// `raw` in normal form when it is a sign-in link: https, no credentials, on a Claude or
/// Anthropic host. Parsed exactly as a browser parses it (WHATWG), so the host checked is the
/// host the browser will visit: `https://evil.com\.claude.ai` is `evil.com` to both.
fn sign_in_link(raw: &str) -> Option<String> {
    let url = tauri::Url::parse(raw).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    // Lowercase, and punycode for anything non-ASCII, so a look-alike never matches.
    let host = url.host_str()?;
    let allowed = SIGN_IN_HOSTS.iter().any(|allowed| {
        host == *allowed
            || host
                .strip_suffix(allowed)
                .is_some_and(|label| label.len() > 1 && label.ends_with('.'))
    });
    allowed.then(|| url.to_string())
}

/// A code fit to send as one line: trimmed, not empty, not too long, and visible ASCII only.
/// Nothing a line reader could take as a line break (\n, \r, U+2028...) gets through.
fn valid_code(code: &str) -> Option<&str> {
    let code = code.trim();
    (!code.is_empty() && code.len() <= MAX_CODE && code.chars().all(|c| c.is_ascii_graphic()))
        .then_some(code)
}

/// The line without terminal colour and hyperlink sequences, for showing in a message.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.next() {
            // CSI: parameters, then one final byte in @..~.
            Some('[') => {
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            // OSC: up to BEL, or ESC followed by a backslash.
            Some(']') => {
                while let Some(next) = chars.next() {
                    if next == '\u{7}' {
                        break;
                    }
                    if next == '\u{1b}' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const LINK: &str = "https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz";

    #[test]
    fn finds_a_plain_sign_in_link() {
        let line = format!("If the browser did not open, visit: {LINK}");
        assert_eq!(sign_in_url(&line).as_deref(), Some(LINK));
    }

    #[test]
    fn finds_a_link_inside_colour_and_a_terminal_hyperlink() {
        let coloured = format!("Visit \u{1b}[4m{LINK}\u{1b}[0m to sign in.");
        let hyperlink = format!("\u{1b}]8;;{LINK}\u{7}Sign in\u{1b}]8;;\u{7}");
        assert_eq!(sign_in_url(&coloured).as_deref(), Some(LINK));
        assert_eq!(sign_in_url(&hyperlink).as_deref(), Some(LINK));
    }

    #[test]
    fn drops_trailing_punctuation() {
        let line = format!("({LINK}).");
        assert_eq!(sign_in_url(&line).as_deref(), Some(LINK));
    }

    #[test]
    fn refuses_links_that_are_not_claude_or_anthropic_over_https() {
        let refused = [
            "visit http://claude.ai/oauth/authorize",
            "visit https://example.com/claude.ai",
            "visit https://claude.ai.example.com/login",
            "visit https://claude.ai@example.com/login",
            "visit https://notclaude.ai/login",
            "no link at all",
        ];
        for line in refused {
            assert_eq!(sign_in_url(line), None, "should have refused: {line}");
        }
        assert!(sign_in_link("https://console.anthropic.com/oauth/code/callback").is_some());
        assert!(sign_in_link("https://claude.com/login").is_some());
        assert!(sign_in_link("https://CLAUDE.AI/login").is_some());
    }

    #[test]
    fn checks_the_host_the_browser_would_visit() {
        // Each of these reads as a Claude host to a naive check, and is not one to a browser.
        let refused = [
            "https://evil.com\\.claude.ai/x",
            "https://evil.com%2f.claude.ai/x",
            "https://claude.ai./x",
            "https://.claude.ai/x",
            "https://user@claude.ai/x",
            "https://xn--claude-ai.com/x",
        ];
        for raw in refused {
            assert_eq!(sign_in_link(raw), None, "should have refused: {raw}");
        }
        // A backslash is a path separator to a browser: this one IS claude.ai, and what gets
        // opened is the normal form, which says so plainly.
        assert_eq!(
            sign_in_link("https://claude.ai\\@evil.com/x").as_deref(),
            Some("https://claude.ai/@evil.com/x")
        );
    }

    #[test]
    fn skips_a_foreign_link_to_find_the_sign_in_one() {
        let line = format!("Docs: https://example.com/help or sign in at {LINK}");
        assert_eq!(sign_in_url(&line).as_deref(), Some(LINK));
    }

    #[test]
    fn accepts_a_code_only_as_one_clean_line() {
        assert_eq!(valid_code("  abc#123  "), Some("abc#123"));
        assert_eq!(valid_code(""), None);
        assert_eq!(valid_code("   "), None);
        assert_eq!(valid_code("abc\ninjected"), None);
        assert_eq!(valid_code("abc\u{2028}injected"), None);
        assert_eq!(valid_code("abc def"), None);
        assert_eq!(valid_code(&"x".repeat(MAX_CODE + 1)), None);
    }

    #[test]
    fn reads_the_status_fields_it_needs() {
        let signed_in =
            br#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","subscriptionType":"pro"}"#;
        let status = parse_status(signed_in).unwrap();
        assert!(status.found && status.logged_in);
        assert_eq!(status.email.as_deref(), Some("a@b.c"));
        assert_eq!(status.subscription.as_deref(), Some("pro"));

        let signed_out = parse_status(br#"{"loggedIn":false}"#).unwrap();
        assert!(signed_out.found && !signed_out.logged_in);
        assert_eq!(parse_status(b"not json"), None);
        assert_eq!(parse_status(br#"{"email":"a@b.c"}"#), None);
    }

    #[test]
    fn strips_colour_and_hyperlinks_for_messages() {
        let line = "\u{1b}[31mError:\u{1b}[0m \u{1b}]8;;https://x\u{7}docs\u{1b}]8;;\u{7} failed";
        assert_eq!(strip_ansi(line), "Error: docs failed");
    }

    /// A stand-in `claude`: `auth login` prints a link and waits for a code on stdin, and
    /// `auth status --json` reports whether the right code arrived.
    #[cfg(unix)]
    fn fake_claude(dir: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let script = dir.join("claude");
        let body = format!(
            r#"#!/bin/sh
here=$(dirname "$0")
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  if [ -f "$here/signed-in" ]; then echo '{{"loggedIn": true}}'; else echo '{{"loggedIn": false}}'; fi
  exit 0
fi
echo "Opening browser to sign in"
printf 'If the browser did not open, visit: \033[4m{LINK}\033[0m\n'
read code
[ "$code" = "good-code" ] && touch "$here/signed-in"
exit 0
"#
        );
        std::fs::write(&script, body).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    #[cfg(unix)]
    async fn sign_in_with(code: &str) -> Vec<Watched> {
        let dir = tempfile::tempdir().unwrap();
        let binary = fake_claude(dir.path());
        let mut child = cli(&binary)
            .args(["auth", "login"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let (_cancel, cancelled) = oneshot::channel();
        let (events, mut received) = mpsc::unbounded_channel();
        let watching = tokio::spawn(watch_login(child, cancelled, binary, events));

        let mut seen = vec![received.recv().await.unwrap()];
        stdin
            .write_all(format!("{code}\n").as_bytes())
            .await
            .unwrap();
        drop(stdin);
        while let Some(event) = received.recv().await {
            seen.push(event);
        }
        watching.await.unwrap();
        seen
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn sends_the_link_then_signed_in_once_the_code_lands() {
        let events = sign_in_with("good-code").await;
        assert_eq!(
            events,
            vec![
                Watched::Link(LINK.to_string()),
                Watched::Done {
                    ok: true,
                    message: "Signed in.".to_string()
                },
            ]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reports_an_unfinished_sign_in_with_what_the_cli_said() {
        let events = sign_in_with("wrong-code").await;
        let Some(Watched::Done { ok, message }) = events.last() else {
            panic!("no Done event: {events:?}");
        };
        assert!(!ok);
        assert!(message.starts_with("Sign-in not finished."), "{message}");
        assert!(message.contains("Opening browser to sign in"), "{message}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_cancelled_sign_in_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let binary = fake_claude(dir.path());
        let mut child = cli(&binary)
            .args(["auth", "login"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        // Held, as `ai_login_start` holds it: `Child::wait` closes a stdin still inside the
        // child, and the CLI would then read end-of-input and exit on its own.
        let _stdin = child.stdin.take().unwrap();
        let (cancel, cancelled) = oneshot::channel();
        let (events, mut received) = mpsc::unbounded_channel();
        let watching = tokio::spawn(watch_login(child, cancelled, binary, events));

        assert!(matches!(received.recv().await, Some(Watched::Link(_))));
        cancel.send(()).unwrap();
        assert_eq!(
            received.recv().await,
            Some(Watched::Done {
                ok: false,
                message: "Sign-in cancelled.".to_string()
            })
        );
        watching.await.unwrap();
    }
}
