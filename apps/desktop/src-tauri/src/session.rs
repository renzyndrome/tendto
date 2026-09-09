//! Where the desktop shell keeps its better-auth **session token**.
//!
//! In the browser the session is an HttpOnly cookie and no application code ever touches it. The
//! Tauri webview cannot use that cookie — it serves the app from a `tauri://localhost` origin, and
//! a SameSite=Lax cookie is never sent cross-site — so the shell authenticates with
//! `Authorization: Bearer <session token>` instead (better-auth's `bearer()` plugin).
//!
//! That token is persisted **here, by Rust**, rather than in the webview's `localStorage`, for the
//! same reason the replica moved to native SQLite: Tauri's webview storage is not reliably kept
//! across app updates, and a session that silently vanishes on every update is a bug the user
//! cannot diagnose. The file is 0600 inside the app's own data directory.
//!
//! It is a bearer credential, so treat it like one: it is never logged, and sign-out deletes it.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Filename inside the app data directory. Not a dotfile — the directory is already private.
const TOKEN_FILE: &str = "session.token";

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("could not access the session store: {0}")]
    Io(#[from] io::Error),
}

/// The session token, cached in memory and mirrored to a 0600 file.
pub struct SessionStore {
    path: PathBuf,
    token: Mutex<Option<String>>,
}

impl SessionStore {
    /// Opens (and creates) the store under `dir`, loading any token already on disk.
    pub fn open(dir: &Path) -> Result<Self, SessionError> {
        create_private_dir(dir)?;
        let path = dir.join(TOKEN_FILE);
        // A missing file is the normal "signed out" state, not an error.
        let token = match fs::read_to_string(&path) {
            Ok(contents) => {
                let trimmed = contents.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_owned())
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path,
            token: Mutex::new(token),
        })
    }

    /// The current token, or `None` when signed out.
    pub fn get(&self) -> Option<String> {
        self.token.lock().expect("session mutex poisoned").clone()
    }

    /// Store a token, replacing any previous one.
    pub fn set(&self, token: String) -> Result<(), SessionError> {
        write_private_file(&self.path, &token)?;
        *self.token.lock().expect("session mutex poisoned") = Some(token);
        Ok(())
    }

    /// Forget the token. Idempotent: clearing when already signed out is not an error.
    pub fn clear(&self) -> Result<(), SessionError> {
        *self.token.lock().expect("session mutex poisoned") = None;
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Write `contents` such that only the owner can read it.
///
/// The mode is set in `OpenOptions` rather than after the write, so the token is never briefly
/// world-readable on disk.
fn write_private_file(path: &Path, contents: &str) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    io::Write::write_all(&mut file, contents.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_survives_reopening_the_store() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SessionStore::open(dir.path()).expect("open");
        assert_eq!(store.get(), None, "a fresh store is signed out");

        store.set("session-abc".into()).expect("set");
        assert_eq!(store.get(), Some("session-abc".into()));

        // The point of the file: a restart must not sign the user out.
        let reopened = SessionStore::open(dir.path()).expect("reopen");
        assert_eq!(reopened.get(), Some("session-abc".into()));
    }

    #[test]
    fn clearing_removes_the_file_and_is_idempotent() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SessionStore::open(dir.path()).expect("open");
        store.set("session-abc".into()).expect("set");

        store.clear().expect("clear");
        assert_eq!(store.get(), None);
        assert!(
            !dir.path().join(TOKEN_FILE).exists(),
            "the file must be gone"
        );

        // Signing out twice, or signing out when never signed in, must not error.
        store.clear().expect("clear again");
        assert_eq!(SessionStore::open(dir.path()).expect("reopen").get(), None);
    }

    #[cfg(unix)]
    #[test]
    fn the_token_file_is_not_readable_by_other_users() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("tempdir");
        let store = SessionStore::open(dir.path()).expect("open");
        store.set("session-abc".into()).expect("set");

        let mode = fs::metadata(dir.path().join(TOKEN_FILE))
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "session token must be owner-only");
    }

    #[test]
    fn a_blank_file_reads_as_signed_out() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join(TOKEN_FILE), "  \n").expect("write");
        assert_eq!(SessionStore::open(dir.path()).expect("open").get(), None);
    }
}
