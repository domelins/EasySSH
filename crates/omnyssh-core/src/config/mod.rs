//! Application configuration modules.
//!
//! - [`app_config`]  — main `~/.config/omnyssh/config.toml`
//! - [`ssh_config`]  — parser for `~/.ssh/config`
//! - [`snippets`]    — `~/.config/omnyssh/snippets.toml`
//!
//! Top-level functions in this module handle loading and persisting the
//! host list (`hosts.toml`).

pub mod app_config;
pub mod snippets;
pub mod ssh_config;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::ssh::client::{Host, HostSource};
use crate::utils::platform;

// ---------------------------------------------------------------------------
// hosts.toml I/O
// ---------------------------------------------------------------------------

/// TOML container for the hosts list.
#[derive(Debug, Default, Serialize, Deserialize)]
struct HostsFile {
    #[serde(default)]
    hosts: Vec<Host>,
}

/// Loads manually-added hosts from `~/.config/omnyssh/hosts.toml`.
///
/// Returns an empty `Vec` if the file does not exist yet.
///
/// # Errors
/// Returns an error if the file exists but cannot be read or parsed.
pub fn load_hosts() -> anyhow::Result<Vec<Host>> {
    let path = platform::hosts_config_path().context("Cannot determine hosts config path")?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;

    let file: HostsFile =
        toml::from_str(&content).with_context(|| format!("Failed to parse {}", path.display()))?;

    Ok(file.hosts)
}

/// Persists the manually-added hosts (source == `Manual`) to
/// `~/.config/omnyssh/hosts.toml`.
///
/// SSH-config-derived hosts are intentionally **not** written — they are
/// re-imported from `~/.ssh/config` on every startup.
///
/// When the profile directory refuses the file — a locked-down or
/// security-protected `%APPDATA%` is the common case on Windows — the same list is
/// written to a portable `omnyssh-data` directory beside the binary instead, so an
/// edit is never silently lost. From then on [`platform::app_config_dir`] reads that
/// directory, which is what makes the fallback survive a restart.
///
/// # Errors
/// Returns an error only when neither directory can be written, and names both
/// failures: the profile one alone no longer explains what happened.
pub fn save_hosts(hosts: &[Host]) -> anyhow::Result<()> {
    let dir = platform::app_config_dir().context("Cannot determine app config directory")?;
    let portable = platform::portable_config_dir();
    save_hosts_to(&dir, portable.as_deref(), hosts)
}

/// [`save_hosts`] with the directories injected, so the fallback is unit-testable.
fn save_hosts_to(
    dir: &std::path::Path,
    portable: Option<&std::path::Path>,
    hosts: &[Host],
) -> anyhow::Result<()> {
    match write_hosts(dir, hosts) {
        Ok(()) => Ok(()),
        Err(profile_error) => {
            let Some(portable) = portable.filter(|portable| *portable != dir) else {
                return Err(profile_error);
            };
            if !platform::is_writable(portable) {
                return Err(profile_error).with_context(|| {
                    format!("回退目录 {} 同样不可写，主机未能保存", portable.display())
                });
            }
            migrate_config(dir, portable);
            write_hosts(portable, hosts).with_context(|| {
                format!(
                    "{} 不可写（{profile_error:#}），回退到 {} 也失败",
                    dir.display(),
                    portable.display()
                )
            })
        }
    }
}

/// Copy the config files a fallback directory does not already have, so switching
/// to it does not silently hide the user's snippets or app settings. Best-effort:
/// a missing source file is normal, and a copy that fails is not worth failing the
/// save over — the hosts file is what the caller asked to persist.
fn migrate_config(from: &std::path::Path, to: &std::path::Path) {
    for name in ["config.toml", "snippets.toml"] {
        let source = from.join(name);
        let target = to.join(name);
        if source.exists() && !target.exists() {
            let _ = std::fs::copy(&source, &target);
        }
    }
}

/// Write the manual hosts to `dir`, atomically. Split out so the caller can retry
/// the same bytes in a fallback directory.
fn write_hosts(dir: &std::path::Path, hosts: &[Host]) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)
        .with_context(|| format!("Failed to create directory {}", dir.display()))?;

    let path = dir.join("hosts.toml");

    let content = hosts_to_toml(hosts)?;

    // Write to a temp file and rename for atomic replacement (avoids a corrupt
    // hosts.toml if the process is interrupted mid-write).
    let tmp_path = path.with_extension("toml.tmp");
    std::fs::write(&tmp_path, content)
        .with_context(|| format!("Failed to write {}", tmp_path.display()))?;
    if let Err(e) = std::fs::rename(&tmp_path, &path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e).with_context(|| {
            format!(
                "Failed to rename {} to {}",
                tmp_path.display(),
                path.display()
            )
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(&path, perms);
    }

    Ok(())
}

/// Serialise the manual hosts in the `hosts.toml` shape — also the export format, so an
/// exported file can be dropped into another machine's config directory as-is.
pub fn hosts_to_toml(hosts: &[Host]) -> anyhow::Result<String> {
    let manual: Vec<Host> = hosts
        .iter()
        .filter(|h| h.source == HostSource::Manual)
        .cloned()
        .collect();
    toml::to_string_pretty(&HostsFile { hosts: manual }).context("Failed to serialise hosts")
}

/// Parse a hosts file (the export format, and what `hosts.toml` holds).
///
/// # Errors
/// Returns an error naming the TOML problem when the file is not a hosts file.
pub fn parse_hosts_toml(content: &str) -> anyhow::Result<Vec<Host>> {
    let file: HostsFile = toml::from_str(content).context("This is not an OmnySSH hosts file")?;
    Ok(file.hosts)
}

/// Export snapshot: every host, SSH-config imports included, frozen as manual entries.
/// Separate from `hosts_to_toml` so writing `hosts.toml` back never carries SSH-config
/// entries. Clearing `original_ssh_host` cuts the live tie to the importing machine's
/// own `~/.ssh/config` (name shadowing and `IdentitiesOnly` follow-along).
pub fn hosts_to_export_toml(hosts: &[Host]) -> anyhow::Result<String> {
    let snapshot: Vec<Host> = hosts
        .iter()
        .cloned()
        .map(|mut h| {
            h.source = HostSource::Manual;
            h.original_ssh_host = None;
            h
        })
        .collect();
    toml::to_string_pretty(&HostsFile { hosts: snapshot }).context("Failed to serialise hosts")
}

/// Loads all hosts: manually-added (`hosts.toml`) merged with hosts
/// imported from `~/.ssh/config`.
///
/// Manual entries take priority over SSH-config entries with the same name.
/// SSH-config entries are appended after all manual ones.
///
/// # Errors
/// Returns an error if `hosts.toml` exists but is unreadable/malformed.
/// A missing or unreadable `~/.ssh/config` is silently ignored.
pub fn load_all_hosts() -> anyhow::Result<Vec<Host>> {
    // 1. Manual hosts (from hosts.toml).
    let manual = load_hosts()?;

    // 2. Hosts from ~/.ssh/config.
    let mut ssh_hosts: Vec<Host> = Vec::new();
    if let Some(ssh_path) = platform::ssh_config_path() {
        if ssh_path.exists() {
            match ssh_config::load_from_file(&ssh_path) {
                Ok(h) => ssh_hosts = h,
                Err(e) => tracing::warn!("SSH config parse error: {}", e),
            }
        }
    }

    // 3. Merge: manual names take priority.
    Ok(merge_hosts(manual, ssh_hosts))
}

/// Merges manually-added hosts with hosts imported from `~/.ssh/config`.
///
/// Manual entries come first and take priority: an SSH-config host is dropped
/// when a manual host already uses its name, or when a manual host records it
/// as a renamed original (via `original_ssh_host`). Such a copy still takes
/// `IdentitiesOnly` from the entry it stands in for: neither editor has a field
/// for it, so a snapshot would be frozen for good.
pub(crate) fn merge_hosts(manual: Vec<Host>, ssh_hosts: Vec<Host>) -> Vec<Host> {
    let manual_names: std::collections::HashSet<String> =
        manual.iter().map(|h| h.name.clone()).collect();

    // Original SSH-config names of hosts that have since been renamed.
    let renamed_ssh_hosts: std::collections::HashSet<String> = manual
        .iter()
        .filter_map(|h| h.original_ssh_host.clone())
        .collect();

    let mut all = manual;
    for copy in &mut all {
        let source = copy.original_ssh_host.as_deref().unwrap_or(&copy.name);
        if let Some(import) = ssh_hosts.iter().find(|h| h.name == source) {
            copy.identities_only = import.identities_only;
        }
    }
    for h in ssh_hosts {
        if !manual_names.contains(&h.name) && !renamed_ssh_hosts.contains(&h.name) {
            all.push(h);
        }
    }
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(name: &str, source: HostSource) -> Host {
        Host {
            name: name.to_string(),
            source,
            ..Host::default()
        }
    }

    /// A manual host renamed from an SSH-config entry named `original`.
    fn renamed(name: &str, original: &str) -> Host {
        Host {
            name: name.to_string(),
            source: HostSource::Manual,
            original_ssh_host: Some(original.to_string()),
            ..Host::default()
        }
    }

    fn names(hosts: &[Host]) -> Vec<&str> {
        hosts.iter().map(|h| h.name.as_str()).collect()
    }

    // --- merge_hosts (P0.3) -----------------------------------------------

    #[test]
    fn merge_empty_both() {
        assert!(merge_hosts(vec![], vec![]).is_empty());
    }

    #[test]
    fn merge_manual_only() {
        let out = merge_hosts(vec![host("a", HostSource::Manual)], vec![]);
        assert_eq!(names(&out), ["a"]);
    }

    #[test]
    fn merge_ssh_only() {
        let out = merge_hosts(vec![], vec![host("a", HostSource::SshConfig)]);
        assert_eq!(names(&out), ["a"]);
    }

    #[test]
    fn merge_manual_listed_before_ssh() {
        let out = merge_hosts(
            vec![host("m", HostSource::Manual)],
            vec![host("s", HostSource::SshConfig)],
        );
        assert_eq!(names(&out), ["m", "s"]);
    }

    #[test]
    fn merge_name_collision_manual_wins() {
        let out = merge_hosts(
            vec![host("web", HostSource::Manual)],
            vec![host("web", HostSource::SshConfig)],
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].source, HostSource::Manual);
    }

    #[test]
    fn merge_renamed_ssh_host_excluded() {
        let out = merge_hosts(
            vec![renamed("new", "old")],
            vec![host("old", HostSource::SshConfig)],
        );
        assert_eq!(names(&out), ["new"]);
    }

    #[test]
    fn merge_renamed_and_collision_combined() {
        // Manual "a" was renamed from ssh "b"; ssh has both "a" and "b".
        let out = merge_hosts(
            vec![renamed("a", "b")],
            vec![
                host("a", HostSource::SshConfig),
                host("b", HostSource::SshConfig),
            ],
        );
        assert_eq!(names(&out), ["a"]);
    }

    #[test]
    fn a_copy_follows_identities_only_in_the_ssh_config() {
        let mut only = host("app01", HostSource::SshConfig);
        only.identities_only = true;
        let mut pinned = renamed("renamed", "db");
        pinned.identities_only = true;
        let out = merge_hosts(
            vec![host("app01", HostSource::Manual), pinned],
            vec![only, host("db", HostSource::SshConfig)],
        );
        assert!(out[0].identities_only, "the line added to ~/.ssh/config");
        assert!(
            !out[1].identities_only,
            "the line removed from ~/.ssh/config"
        );
    }

    #[test]
    fn merge_multiple_ssh_distinct_names_kept() {
        let out = merge_hosts(
            vec![],
            vec![
                host("a", HostSource::SshConfig),
                host("b", HostSource::SshConfig),
                host("c", HostSource::SshConfig),
            ],
        );
        assert_eq!(names(&out), ["a", "b", "c"]);
    }

    #[test]
    fn merge_rename_keeps_unrelated_ssh_host() {
        let out = merge_hosts(
            vec![renamed("a", "b")],
            vec![
                host("b", HostSource::SshConfig),
                host("c", HostSource::SshConfig),
            ],
        );
        assert_eq!(names(&out), ["a", "c"]);
    }

    // --- HostsFile serialization (P0.4) -----------------------------------

    #[test]
    fn hostsfile_roundtrip_preserves_fields() {
        let mut h = host("web", HostSource::Manual);
        h.hostname = "10.0.0.1".to_string();
        h.user = "deploy".to_string();
        h.port = 2222;
        h.tags = vec!["prod".to_string()];
        let toml_str = toml::to_string_pretty(&HostsFile { hosts: vec![h] }).unwrap();
        let parsed: HostsFile = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.hosts.len(), 1);
        let g = &parsed.hosts[0];
        assert_eq!(g.name, "web");
        assert_eq!(g.hostname, "10.0.0.1");
        assert_eq!(g.user, "deploy");
        assert_eq!(g.port, 2222);
        assert_eq!(g.tags, vec!["prod"]);
    }

    #[test]
    fn hostsfile_save_filter_keeps_only_manual() {
        // Replicates the `source == Manual` filter applied by save_hosts.
        let hosts = [
            host("m", HostSource::Manual),
            host("s", HostSource::SshConfig),
        ];
        let manual: Vec<Host> = hosts
            .iter()
            .filter(|h| h.source == HostSource::Manual)
            .cloned()
            .collect();
        assert_eq!(names(&manual), ["m"]);
    }

    #[test]
    fn hostsfile_empty_input_parses_to_empty() {
        let parsed: HostsFile = toml::from_str("").unwrap();
        assert!(parsed.hosts.is_empty());
    }

    #[test]
    fn hostsfile_omits_none_optional_fields() {
        let toml_str = toml::to_string_pretty(&HostsFile {
            hosts: vec![host("a", HostSource::Manual)],
        })
        .unwrap();
        assert!(!toml_str.contains("identity_file"));
        assert!(!toml_str.contains("password"));
    }

    #[test]
    fn hostsfile_password_survives_roundtrip() {
        // Confirms passwords are persisted in plaintext.
        let mut h = host("a", HostSource::Manual);
        h.password = Some("secret".to_string());
        let toml_str = toml::to_string_pretty(&HostsFile { hosts: vec![h] }).unwrap();
        let parsed: HostsFile = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.hosts[0].password.as_deref(), Some("secret"));
    }

    // ---- Saving through a fallback directory ----

    /// A unique scratch directory for one test.
    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("omnyssh-cfg-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    /// A path whose parent is a regular file: `create_dir_all` must fail on it.
    fn blocked_dir(root: &std::path::Path) -> std::path::PathBuf {
        let _ = std::fs::create_dir_all(root);
        let file = root.join("not-a-directory");
        std::fs::write(&file, b"x").expect("blocker file");
        file.join("config")
    }

    #[test]
    fn save_writes_to_the_profile_directory_when_it_is_writable() {
        let root = scratch("primary");
        let hosts = vec![host("web", HostSource::Manual)];
        save_hosts_to(&root, Some(&root.join("portable")), &hosts).expect("save");
        assert!(root.join("hosts.toml").exists());
        assert!(!root.join("portable").join("hosts.toml").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn save_falls_back_to_the_portable_directory_and_keeps_the_host() {
        let root = scratch("fallback");
        let blocked = blocked_dir(&root);
        let portable = root.join("portable");
        let hosts = vec![host("new-host", HostSource::Manual)];

        save_hosts_to(&blocked, Some(&portable), &hosts).expect("fallback save");

        let written = std::fs::read_to_string(portable.join("hosts.toml")).expect("portable file");
        assert!(written.contains("new-host"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn save_copies_snippets_into_a_fresh_fallback_directory() {
        let root = scratch("migrate");
        // A writable directory whose hosts.toml.tmp is a directory: the write the
        // save performs fails, while the other files are perfectly readable.
        let source = root.join("source");
        std::fs::create_dir_all(&source).expect("source");
        std::fs::write(
            source.join("snippets.toml"),
            b"[[snippets]]\nname = \"x\"\n",
        )
        .expect("snippets");
        std::fs::create_dir(source.join("hosts.toml.tmp")).expect("blocker dir");
        let portable = root.join("portable");

        save_hosts_to(&source, Some(&portable), &[host("web", HostSource::Manual)])
            .expect("fallback save");

        assert!(portable.join("hosts.toml").exists());
        assert!(portable.join("snippets.toml").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn save_reports_failure_when_neither_directory_is_writable() {
        let root = scratch("both-blocked");
        let blocked = blocked_dir(&root);
        let portable_blocked = blocked_dir(&root.join("second"));
        let err = save_hosts_to(
            &blocked,
            Some(&portable_blocked),
            &[host("web", HostSource::Manual)],
        )
        .expect_err("nothing is writable");
        let text = format!("{err:#}");
        assert!(text.contains("回退目录"), "{text}");
        let _ = std::fs::remove_dir_all(&root);
    }

    // --- export snapshot ----------------------------------------------------

    #[test]
    fn export_snapshot_freezes_ssh_hosts_as_manual_and_keeps_secrets() {
        let mut manual = host("web", HostSource::Manual);
        manual.password = Some("secret".to_string());
        manual.tags = vec!["prod".to_string()];
        let mut imported = host("bastion", HostSource::SshConfig);
        imported.original_ssh_host = Some("bastion".to_string());
        imported.identities_only = true;
        imported.port = 2222;
        let toml = hosts_to_export_toml(&[manual, imported]).expect("serialise");
        let parsed = parse_hosts_toml(&toml).expect("parse");
        assert_eq!(names(&parsed), ["web", "bastion"]);
        assert!(parsed.iter().all(|h| h.source == HostSource::Manual));
        assert!(parsed.iter().all(|h| h.original_ssh_host.is_none()));
        assert_eq!(parsed[0].password.as_deref(), Some("secret"));
        assert_eq!(parsed[0].tags, vec!["prod"]);
        assert!(parsed[1].identities_only, "the frozen snapshot value");
        assert_eq!(parsed[1].port, 2222);
    }

    #[test]
    fn hosts_to_toml_still_writes_only_manual_hosts() {
        // Guardrail: the export snapshot must not change what write_hosts persists —
        // SSH-config entries never land in hosts.toml.
        let hosts = [
            host("m", HostSource::Manual),
            host("s", HostSource::SshConfig),
        ];
        let parsed =
            parse_hosts_toml(&hosts_to_toml(&hosts).expect("serialise")).expect("parse");
        assert_eq!(names(&parsed), ["m"]);
    }
}
