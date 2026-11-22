//! SFTP session commands (tech-gui.md §4.2). `sftp_open` awaits the core connect and
//! spawns a per-session forwarder that stamps every `sftp-*` event with the tab's
//! session id (§3.4); the remote ops are thin `SftpCommand` enqueues whose results
//! arrive as events.

use tauri::{AppHandle, State};
use tokio::sync::mpsc;

use omnyssh_core::event::CoreEvent;
use omnyssh_core::ssh::identity;
use omnyssh_core::ssh::password::Prompter;
use omnyssh_core::ssh::sftp::{SftpCommand, SftpManager};

use crate::bridge;
use crate::error::CommandError;
use crate::state::GuiState;

/// A tab's dedicated core-event channel buffer. Comfortably absorbs the connect ack
/// plus a burst of transfer-progress ticks before the forwarder drains them (§3.4).
const SFTP_EVENT_BUFFER: usize = 256;

/// Open an SFTP session for `host_name` (tech-gui.md §4.2). Awaits the core connect,
/// registers the manager under a fresh public id, and spawns the per-session
/// forwarder; the `sftp-connected` ack then arrives stamped with that id (§3.4).
#[tauri::command]
#[specta::specta]
pub async fn sftp_open(
    app: AppHandle,
    state: State<'_, GuiState>,
    host_name: String,
) -> Result<u64, CommandError> {
    let host = state.host_by_name(&host_name).ok_or_else(|| CommandError {
        message: format!("未知主机 '{host_name}'"),
    })?;
    // A dedicated channel per tab: its owner is the session id, so the forwarder can
    // attribute the core's session-less `sftp-*` events to this tab (§3.4).
    let (tx, rx) = mpsc::channel::<CoreEvent>(SFTP_EVENT_BUFFER);
    // The prompt goes out on the engine channel: this tab's own channel only
    // carries `sftp-*` events.
    let prompter = Prompter::new(state.engine_sender(), &host_name);
    let manager = match SftpManager::connect(&host, tx, prompter).await {
        Ok(manager) => manager,
        Err(e) => {
            if let Some(path) = omnyssh_core::ssh::session::passphrase_required(&e) {
                identity::ask_passphrase(&state.engine_sender(), &host_name, path).await;
            }
            // The whole chain: the core wraps the cause in "SFTP SSH connect".
            return Err(CommandError {
                message: format!("{e:#}"),
            });
        }
    };
    let session_id = state.register_sftp(manager);
    tauri::async_runtime::spawn(bridge::forward_sftp_events(app, session_id, rx));
    Ok(session_id)
}

/// List a remote directory (tech-gui.md §4.2); the result arrives as `sftp-dir-listed`.
#[tauri::command]
#[specta::specta]
pub fn sftp_list(
    state: State<'_, GuiState>,
    session_id: u64,
    path: String,
) -> Result<(), CommandError> {
    state.send_sftp(session_id, SftpCommand::ListDir(path));
    Ok(())
}

/// Upload a local file or folder to a remote path (tech-gui.md §4.2). Allocates a
/// transfer id owned by this session so `transfer-progress` routes back to the tab
/// (§3.4).
#[tauri::command]
#[specta::specta]
pub fn sftp_upload(
    state: State<'_, GuiState>,
    session_id: u64,
    local: String,
    remote: String,
) -> Result<(), CommandError> {
    let transfer_id = state.next_transfer(session_id);
    state.send_sftp(
        session_id,
        SftpCommand::Upload {
            local,
            remote,
            transfer_id,
        },
    );
    Ok(())
}

/// Download a remote file or folder to a local path (tech-gui.md §4.2). See
/// `sftp_upload` for the transfer-id routing. `local` ends in the name the server
/// listed, which the frontend checks is one plain name; the core keeps every name in
/// a folder inside the destination (§3.2).
#[tauri::command]
#[specta::specta]
pub fn sftp_download(
    state: State<'_, GuiState>,
    session_id: u64,
    local: String,
    remote: String,
) -> Result<(), CommandError> {
    let transfer_id = state.next_transfer(session_id);
    state.send_sftp(
        session_id,
        SftpCommand::Download {
            remote,
            local,
            transfer_id,
        },
    );
    Ok(())
}

/// Create a remote directory (tech-gui.md §4.2); completion arrives as `sftp-op-done`.
#[tauri::command]
#[specta::specta]
pub fn sftp_mkdir(
    state: State<'_, GuiState>,
    session_id: u64,
    path: String,
) -> Result<(), CommandError> {
    state.send_sftp(session_id, SftpCommand::MkDir(path));
    Ok(())
}

/// Rename / move a remote path (tech-gui.md §4.2).
#[tauri::command]
#[specta::specta]
pub fn sftp_rename(
    state: State<'_, GuiState>,
    session_id: u64,
    from: String,
    to: String,
) -> Result<(), CommandError> {
    state.send_sftp(session_id, SftpCommand::Rename { from, to });
    Ok(())
}

/// Delete a remote file (falls back to an empty directory in the core) (tech-gui.md §4.2).
#[tauri::command]
#[specta::specta]
pub fn sftp_delete(
    state: State<'_, GuiState>,
    session_id: u64,
    path: String,
) -> Result<(), CommandError> {
    state.send_sftp(session_id, SftpCommand::Delete(path));
    Ok(())
}

/// Read a remote text file whole for the editor; arrives as `file-content`, which
/// carries either the text or the reason it cannot be edited here.
#[tauri::command]
#[specta::specta]
pub fn sftp_read_file(
    state: State<'_, GuiState>,
    session_id: u64,
    path: String,
) -> Result<(), CommandError> {
    state.send_sftp(session_id, SftpCommand::ReadFile(path));
    Ok(())
}

/// Replace a remote text file's contents (creating it if missing). Completion arrives
/// as `sftp-op-done`, like the other mutating operations, so the pane re-lists.
#[tauri::command]
#[specta::specta]
pub fn sftp_write_file(
    state: State<'_, GuiState>,
    session_id: u64,
    path: String,
    content: String,
) -> Result<(), CommandError> {
    state.send_sftp(session_id, SftpCommand::WriteFile { path, content });
    Ok(())
}

/// Close an SFTP session and its connection, stopping its transfer (tech-gui.md §4.2).
#[tauri::command]
#[specta::specta]
pub fn sftp_close(state: State<'_, GuiState>, session_id: u64) -> Result<(), CommandError> {
    state.close_sftp(session_id);
    Ok(())
}

/// Change a remote entry's permission bits; completes as `sftp-op-done`.
#[tauri::command]
#[specta::specta]
pub fn sftp_chmod(
    state: State<'_, GuiState>,
    session_id: u64,
    path: String,
    mode: u32,
) -> Result<(), CommandError> {
    state.send_sftp(session_id, SftpCommand::Chmod { path, mode });
    Ok(())
}

/// Compress `dir/name` on the host into `dir/name.tar.gz` with `tar`.
///
/// Runs over a short-lived SSH exec channel (the SFTP session has no shell), quoting
/// every path as a single shell word. Returns the archive path.
#[tauri::command]
#[specta::specta]
pub async fn compress_remote(
    state: State<'_, GuiState>,
    host_name: String,
    dir: String,
    name: String,
) -> Result<String, CommandError> {
    if name.is_empty() || name.contains('/') || dir.contains('\0') || name.contains('\0') {
        return Err(CommandError {
            message: "无法压缩：路径包含不支持的内容".to_string(),
        });
    }
    let host = state.host_by_name(&host_name).ok_or_else(|| CommandError {
        message: format!("找不到主机 {host_name}"),
    })?;
    let archive = format!("{}/{}.tar.gz", dir.trim_end_matches('/'), name);
    let command = format!(
        "tar -czf {} -C {} {}",
        shell_word(&archive),
        shell_word(&dir),
        shell_word(&name)
    );
    let session = omnyssh_core::ssh::session::SshSession::connect(&host)
        .await
        .map_err(|e| CommandError {
            message: format!("连接主机失败：{e:#}"),
        })?;
    session
        .run_command_checked_with_timeout(&command, ARCHIVE_TIMEOUT)
        .await
        .map_err(|e| CommandError {
            message: format!("压缩失败：{e:#}"),
        })?;
    Ok(archive)
}

/// How long a remote pack/unpack may take: a large folder outlives the 30 s probe leash.
const ARCHIVE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// The pack/transfer/unpack helpers behind seamless folder transfers (tech-gui.md §4.2).
/// `pack` archives `dir/name` into a fresh temp file and returns its path; `unpack`
/// extracts `archive` into `dest` and always removes the archive; `temp` only allocates
/// a temp path (the upload destination); `remove` deletes a leftover archive.
///
/// Runs over a short-lived SSH exec channel like `compress_remote`. The mktemp template
/// must end in its X's (GNU/BSD/busybox), so the archive carries no `.tar.gz` suffix —
/// neither tar nor the transfer cares.
#[tauri::command]
#[specta::specta]
pub async fn remote_archive(
    state: State<'_, GuiState>,
    host_name: String,
    action: String,
    dir: Option<String>,
    name: Option<String>,
    archive: Option<String>,
    dest: Option<String>,
) -> Result<Option<String>, CommandError> {
    fn bad(message: &str) -> CommandError {
        CommandError {
            message: message.to_string(),
        }
    }
    let command = match action.as_str() {
        "pack" => {
            let (dir, name) = (
                dir.ok_or_else(|| bad("无法打包：缺少目录"))?,
                name.ok_or_else(|| bad("无法打包：缺少文件夹名"))?,
            );
            if name.is_empty() || name.contains('/') || name.contains('\0') || dir.contains('\0') {
                return Err(bad("无法打包：路径包含不支持的内容"));
            }
            format!(
                "p=$(mktemp \"${{TMPDIR:-/tmp}}/omnyssh-XXXXXXXX\") || exit 1; \
                 if tar -czf \"$p\" -C {} {}; then printf '%s' \"$p\"; else rm -f \"$p\"; exit 1; fi",
                shell_word(&dir),
                shell_word(&name)
            )
        }
        "unpack" => {
            let (archive, dest) = (
                archive.ok_or_else(|| bad("无法解压：缺少压缩包"))?,
                dest.ok_or_else(|| bad("无法解压：缺少目标目录"))?,
            );
            if archive.contains('\0') || dest.contains('\0') {
                return Err(bad("无法解压：路径包含不支持的内容"));
            }
            // stderr joins stdout so the checked error carries tar's own message.
            format!(
                "out=$(tar -xzf {} -C {} 2>&1); s=$?; rm -f {}; printf '%s' \"$out\"; exit $s",
                shell_word(&archive),
                shell_word(&dest),
                shell_word(&archive)
            )
        }
        "temp" => "mktemp \"${TMPDIR:-/tmp}/omnyssh-XXXXXXXX\"".to_string(),
        "remove" => {
            let archive = archive.ok_or_else(|| bad("无法清理：缺少压缩包"))?;
            if archive.contains('\0') {
                return Err(bad("无法清理：路径包含不支持的内容"));
            }
            format!("rm -f {}", shell_word(&archive))
        }
        other => return Err(bad(&format!("未知的打包操作 {other}"))),
    };
    let host = state.host_by_name(&host_name).ok_or_else(|| CommandError {
        message: format!("找不到主机 {host_name}"),
    })?;
    let session = omnyssh_core::ssh::session::SshSession::connect(&host)
        .await
        .map_err(|e| CommandError {
            message: format!("连接主机失败：{e:#}"),
        })?;
    let label = match action.as_str() {
        "pack" => "打包失败",
        "unpack" => "解压失败",
        "temp" => "创建临时文件失败",
        _ => "清理失败",
    };
    let timeout = if action == "pack" || action == "unpack" {
        ARCHIVE_TIMEOUT
    } else {
        std::time::Duration::from_secs(30)
    };
    let output = session
        .run_command_checked_with_timeout(&command, timeout)
        .await
        .map_err(|e| CommandError {
            message: format!("{label}：{e:#}"),
        })?;
    Ok(match action.as_str() {
        "pack" | "temp" => Some(output.trim_end().to_string()),
        _ => None,
    })
}

/// The local half of the seamless folder transfer: `pack` archives `path` (a folder)
/// into a temp `.tar.gz` and returns its path, `unpack` extracts `path` into `dest` and
/// removes the archive, `remove` deletes a leftover archive. Blocking FS work stays off
/// the async runtime.
#[tauri::command]
#[specta::specta]
pub async fn local_archive(
    action: String,
    path: String,
    dest: Option<String>,
) -> Result<Option<String>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        local_archive_blocking(&action, &path, dest.as_deref())
    })
    .await
    .map_err(|e| CommandError {
        message: format!("打包任务失败：{e}"),
    })?
}

fn local_archive_blocking(
    action: &str,
    path: &str,
    dest: Option<&str>,
) -> Result<Option<String>, CommandError> {
    fn fail(label: &str, e: impl std::fmt::Display) -> CommandError {
        CommandError {
            message: format!("{label}：{e}"),
        }
    }
    match action {
        "pack" => {
            let src = std::path::Path::new(path);
            let name = src
                .file_name()
                .ok_or_else(|| fail("无法打包", "路径没有文件夹名"))?;
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let archive =
                std::env::temp_dir().join(format!("omnyssh-{}-{stamp}.tar.gz", std::process::id()));
            let file = std::fs::File::create(&archive).map_err(|e| fail("打包失败", e))?;
            let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);
            // Entries carry the folder name, so unpacking lands `dest/name/…`.
            builder
                .append_dir_all(name, src)
                .map_err(|e| fail("打包失败", e))?;
            builder
                .into_inner()
                .map_err(|e| fail("打包失败", e))?
                .finish()
                .map_err(|e| fail("打包失败", e))?;
            Ok(Some(archive.to_string_lossy().into_owned()))
        }
        "unpack" => {
            let dest = dest.ok_or_else(|| fail("无法解压", "缺少目标目录"))?;
            let file = std::fs::File::open(path).map_err(|e| fail("解压失败", e))?;
            tar::Archive::new(flate2::read::GzDecoder::new(file))
                .unpack(dest)
                .map_err(|e| fail("解压失败", e))?;
            let _ = std::fs::remove_file(path);
            Ok(None)
        }
        "remove" => {
            match std::fs::remove_file(path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                other => other,
            }
            .map_err(|e| fail("清理失败", e))?;
            Ok(None)
        }
        other => Err(fail("打包任务失败", format!("未知的操作 {other}"))),
    }
}

/// One shell word, single-quoted with embedded quotes escaped.
fn shell_word(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::local_archive_blocking;

    #[test]
    fn packs_and_unpacks_a_folder_round_trip() {
        let root = tempfile::tempdir().unwrap();
        let src = root.path().join("photos");
        std::fs::create_dir_all(src.join("nested")).unwrap();
        std::fs::write(src.join("nested").join("a.txt"), b"hello").unwrap();
        let archive = local_archive_blocking("pack", src.to_str().unwrap(), None)
            .unwrap()
            .unwrap();
        assert!(std::path::Path::new(&archive).exists());
        let dest = root.path().join("out");
        std::fs::create_dir_all(&dest).unwrap();
        local_archive_blocking("unpack", &archive, Some(dest.to_str().unwrap())).unwrap();
        assert_eq!(
            std::fs::read(dest.join("photos").join("nested").join("a.txt")).unwrap(),
            b"hello"
        );
        // Unpack consumes the archive; remove tolerates an already-gone one.
        assert!(!std::path::Path::new(&archive).exists());
        local_archive_blocking("remove", &archive, None).unwrap();
    }
}
