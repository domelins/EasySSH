//! Where the frontend's shared UI-pref store lives. tauri-plugin-store resolves a
//! relative path against the profile's AppData directory; when a security product
//! refuses this process writes there — the same case that sends `hosts.toml` to the
//! portable `omnyssh-data` directory — every preference save silently fails and the
//! next launch hydrates the stale file, so the theme "resets" on every restart. The
//! store file follows the same fallback the core already uses.

use tauri::{AppHandle, Manager};

use crate::error::CommandError;

/// Absolute path of the shared UI settings store (`settings.json`): the profile's
/// AppData directory while it accepts writes, otherwise `omnyssh-data` beside the
/// executable. The frontend passes the result to `load()` as an absolute path, which
/// the store plugin keeps verbatim.
#[tauri::command]
#[specta::specta]
pub async fn settings_store_path(app: AppHandle) -> Result<String, CommandError> {
    let error = |e: &dyn std::fmt::Display| CommandError {
        message: e.to_string(),
    };
    let primary = app.path().app_config_dir().map_err(|e| error(&e))?;
    if easyssh_core::utils::platform::is_writable(&primary) {
        return Ok(primary.join("settings.json").to_string_lossy().into_owned());
    }
    let portable = easyssh_core::utils::platform::portable_config_dir()
        .ok_or_else(|| error(&"无法定位可执行文件目录"))?;
    std::fs::create_dir_all(&portable).map_err(|e| error(&e))?;
    // No migration of the stale AppData copy: once writes there started failing, the
    // frontend's localStorage mirrors became the fresher record, and every store seeds
    // itself from its mirror before hydrate runs. Copying the old file would resurrect
    // superseded values (the very theme reset this fallback exists to end).
    Ok(portable
        .join("settings.json")
        .to_string_lossy()
        .into_owned())
}
