//! Webview chrome the app does not want. The engine's built-in right-click menu
//! (back / reload / save as / print / inspect) is browser chrome, not app UI; the
//! app's own menus are DOM elements and stay untouched.

use crate::error::CommandError;

/// Turn off the webview's default context menu and the devtools entry it carries.
/// Called once per window from the root layout, when the platform webview is fully
/// initialised — at setup time WebView2's core may not exist yet.
#[tauri::command]
#[specta::specta]
pub fn disable_default_context_menu(webview: tauri::Webview) -> Result<(), CommandError> {
    #[cfg(target_os = "windows")]
    webview
        .with_webview(|platform| unsafe {
            let controller = platform.controller();
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(settings) = core.Settings() {
                    let _ = settings.SetAreDefaultContextMenusEnabled(false);
                    let _ = settings.SetAreDevToolsEnabled(false);
                }
            }
        })
        .map_err(|e| CommandError {
            message: e.to_string(),
        })?;
    #[cfg(target_os = "linux")]
    webview
        .with_webview(|platform| {
            use webkit2gtk::{SettingsExt, WebViewExt};
            let view = platform.inner();
            if let Some(settings) = view.settings() {
                settings.set_enable_developer_extras(false);
            }
            // Returning true consumes the signal: WebKitGTK never builds its menu.
            view.connect_context_menu(|_, _, _, _| true);
        })
        .map_err(|e| CommandError {
            message: e.to_string(),
        })?;
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let _ = webview;
    Ok(())
}