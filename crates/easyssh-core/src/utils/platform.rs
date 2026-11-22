use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Rolling log files older than this many days are pruned at startup.
pub const LOG_RETENTION_DAYS: u64 = 7;

/// Prefix shared by every rolling log file (`omnyssh.log`, `omnyssh.log.YYYY-MM-DD`).
const LOG_FILE_PREFIX: &str = "omnyssh.log";

/// Returns the path to the user's SSH config file.
///
/// - Linux / macOS: `~/.ssh/config`
/// - Windows:       `%USERPROFILE%\.ssh\config`
///
/// Uses the `dirs` crate so we never hardcode `~`.
pub fn ssh_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("config"))
}

/// Returns the application config directory.
///
/// - Linux:   `~/.config/omnyssh/`
/// - macOS:   `~/Library/Application Support/omnyssh/`
/// - Windows: `%APPDATA%\omnyssh\`
///
/// `OMNYSSH_CONFIG_DIR` overrides it outright, and a portable directory beside the
/// binary wins once it holds a `hosts.toml`: that file only appears there when the
/// profile directory turned out to be unwritable (see [`save_hosts`]), and keeping
/// reads on the same directory is what makes such a fallback survive a restart.
pub fn app_config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("OMNYSSH_CONFIG_DIR") {
        return Some(PathBuf::from(dir));
    }
    if let Some(portable) = portable_config_dir() {
        if portable.join("hosts.toml").exists() {
            return Some(portable);
        }
    }
    dirs::config_dir().map(|d| d.join("omnyssh"))
}

/// The portable config directory: `omnyssh-data` beside the executable. It is the
/// fallback for a profile directory this process cannot write (a locked-down
/// AppData, a security product protecting it), and doubles as a portable install.
pub fn portable_config_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("omnyssh-data")))
}

/// Whether `dir` exists (or can be created) and accepts a small file. Probing the
/// real write is the only check that also catches a directory whose permissions
/// look right but which the OS or a security product refuses.
pub fn is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-test");
    let written = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(&probe);
    written
}

/// The user's downloads directory, falling back to their home directory: where an
/// exported hosts file goes when the app cannot ask for a folder.
pub fn download_dir() -> Option<PathBuf> {
    dirs::download_dir().or_else(dirs::home_dir)
}

/// Returns the path to the main application config file.
pub fn app_config_path() -> Option<PathBuf> {
    app_config_dir().map(|d| d.join("config.toml"))
}

/// Returns the path to the hosts config file.
pub fn hosts_config_path() -> Option<PathBuf> {
    app_config_dir().map(|d| d.join("hosts.toml"))
}

/// Returns the path to the snippets config file.
pub fn snippets_config_path() -> Option<PathBuf> {
    app_config_dir().map(|d| d.join("snippets.toml"))
}

/// Removes rolling log files in `log_dir` older than `max_age_days`.
///
/// Best-effort and fault-tolerant: a missing directory, an unreadable entry,
/// or a failed delete is skipped rather than propagated, so log cleanup never
/// blocks application startup. File age is taken from the filesystem
/// modification time, which keeps the logic identical on every OS. Only files
/// whose name starts with `omnyssh.log` are considered, so config and other
/// data files in the same directory are never touched.
///
/// Returns the number of files removed.
pub fn cleanup_old_logs(log_dir: &Path, max_age_days: u64) -> usize {
    let entries = match std::fs::read_dir(log_dir) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    let max_age = Duration::from_secs(max_age_days * 24 * 60 * 60);
    let now = SystemTime::now();
    let mut removed = 0;

    for entry in entries.flatten() {
        let path = entry.path();

        let is_log_file = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with(LOG_FILE_PREFIX))
            .unwrap_or(false);
        if !is_log_file {
            continue;
        }

        let modified = match entry.metadata().and_then(|meta| meta.modified()) {
            Ok(modified) => modified,
            Err(_) => continue,
        };

        // `duration_since` errors on files dated in the future (clock skew);
        // treat those as recent and keep them.
        if let Ok(age) = now.duration_since(modified) {
            if age > max_age && std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }

    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_dir_sits_beside_the_binary() {
        let dir = portable_config_dir().expect("a running binary has a directory");
        assert_eq!(
            dir.file_name().and_then(|n| n.to_str()),
            Some("omnyssh-data")
        );
        let exe = std::env::current_exe().expect("exe");
        assert_eq!(dir.parent(), exe.parent());
    }

    #[test]
    fn writable_reports_a_fresh_directory() {
        let dir = std::env::temp_dir().join(format!("omnyssh-writable-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(is_writable(&dir));
        assert!(dir.is_dir());
        // The probe must not linger in the directory it checked.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .expect("read back")
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writable_rejects_a_path_under_a_file() {
        let root = std::env::temp_dir().join(format!("omnyssh-blocked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("root");
        let file = root.join("file");
        std::fs::write(&file, b"x").expect("file");
        assert!(!is_writable(&file.join("nested")));
        let _ = std::fs::remove_dir_all(&root);
    }
}
