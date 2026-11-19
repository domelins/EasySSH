//! Launch-time contract of the desktop app. These are link-time or native-window
//! settings that no runtime assertion can reach from a test binary (`cargo test`
//! always builds with `debug_assertions`), so they are guarded at their source.

use std::path::Path;

const MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");
const MAIN_RS: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"));

/// Without this attribute the binary links as a console app and Windows opens a
/// terminal next to the window for the whole session — debug builds included, since
/// the `target\debug` exe is what people run.
#[test]
fn windows_builds_link_as_a_gui_binary() {
    assert!(
        MAIN_RS.contains(r#"#![cfg_attr(windows, windows_subsystem = "windows")]"#),
        "src/main.rs no longer declares the windows_subsystem attribute — Windows \
         builds would open a console window alongside the app"
    );
}

/// The window is revealed only once the page is up, so the launch never shows the
/// webview's blank base colour. The background is what the fallback reveal paints
/// when the frontend is slow, so it has to match the app's own dark surface.
#[test]
fn the_window_starts_hidden_on_the_dark_background() {
    let config: serde_json::Value =
        serde_json::from_str(&read(Path::new(MANIFEST_DIR).join("tauri.conf.json")))
            .expect("tauri.conf.json is valid JSON");
    let window = &config["app"]["windows"][0];

    assert_eq!(
        window["visible"],
        serde_json::json!(false),
        "the main window must be created hidden and revealed on page load"
    );
    assert_eq!(
        window["backgroundColor"].as_str().map(str::to_lowercase),
        Some(dark_background_token()),
        "the native window background drifted from the dark --bg token"
    );
}

/// The other half of `visible: false`: drop either reveal and the app becomes a
/// running process with no window and no way to reach it.
#[test]
fn a_hidden_window_is_always_revealed() {
    assert!(
        MAIN_RS.contains(".on_page_load("),
        "the page-load reveal is gone — the window would stay hidden until the fallback"
    );
    assert!(
        MAIN_RS.contains("REVEAL_FALLBACK"),
        "the fallback reveal is gone — a frontend that never loads would leave no window"
    );
}

/// The reveal doubles as the signal that the page loaded, and the render retry reads
/// it. Drop this one store and every Linux launch looks like a failed one, so the app
/// would restart itself into software rendering every single time — with every other
/// test still green.
#[test]
fn a_loaded_page_is_recorded_for_the_render_retry() {
    assert!(
        MAIN_RS.contains("PAGE_LOADED.store("),
        "the page-load flag is no longer set — the app would restart itself on every \
         Linux launch"
    );
}

/// A debug build waits on the dev server, so a slow one starting must never look like
/// a broken renderer and re-exec the app out from under a contributor.
#[test]
fn the_render_retry_is_a_release_only_behaviour() {
    assert!(
        MAIN_RS.contains(r#"#[cfg(all(target_os = "linux", not(debug_assertions)))]"#),
        "the render retry is no longer gated to release builds — `tauri dev` would \
         restart itself whenever the dev server is slow"
    );
}

/// The retry re-execs the app, so the one thing standing between it and an endless
/// restart loop is the child inheriting the marker the parent tested for. The two are
/// three lines apart and nothing else connects them: rename the string in `cmd.env`
/// alone and the loop is silent, unbounded, and only reproducible on Linux.
#[test]
fn the_render_retry_marks_the_child_it_starts() {
    assert!(
        MAIN_RS.contains(".env(RETRY_MARKER, \"1\")"),
        "the render retry no longer marks its child with RETRY_MARKER — the restart \
         would repeat for as long as the page fails to load"
    );
    assert!(
        MAIN_RS.contains("std::env::var_os(RETRY_MARKER)"),
        "the render retry no longer reads RETRY_MARKER — a marked child would restart \
         itself again"
    );
}

/// A second launch has to exit before anything else starts, and only the first plugin
/// runs before all the others. Moved down the list, the second copy would open the
/// settings store and the updater — and, with the tray, a second icon — before quitting.
#[test]
fn the_single_instance_plugin_is_registered_first() {
    let first = MAIN_RS.find(".plugin(").expect("main.rs registers plugins");
    assert!(
        MAIN_RS[first..].starts_with(".plugin(tauri_plugin_single_instance::init("),
        "tauri_plugin_single_instance is no longer the first plugin registered"
    );
}

/// The window hides into the tray only; `prevent_exit` would also swallow the tray's
/// own Quit, leaving an app with no window that cannot be closed.
#[test]
fn nothing_prevents_the_app_from_exiting() {
    let tray = read(Path::new(MANIFEST_DIR).join("src/tray.rs"));
    assert!(
        !MAIN_RS.contains("prevent_exit(") && !tray.contains("prevent_exit("),
        "prevent_exit would block the tray's Quit"
    );
}

/// Window geometry is restored by a plugin whose default flag set includes `VISIBLE`,
/// which it applies from `on_window_ready` — before the page exists. Fall back to those
/// defaults and every launch shows the window over a blank webview again, undoing the
/// reveal. `WINDOW_STATE_FLAGS` carries a compile-time guard of its own; this catches
/// the other half, a call site that stops using it.
#[test]
fn window_state_restores_geometry_but_never_visibility() {
    assert!(
        MAIN_RS.contains(".with_state_flags(WINDOW_STATE_FLAGS)"),
        "the window-state plugin no longer takes its flags from WINDOW_STATE_FLAGS — \
         the default set includes VISIBLE and would reveal the window before it painted"
    );
}

/// The rpm bundler writes `Requires:` from this list and nothing else — it never scans
/// the binary — so an empty list ships a package that installs onto a system with no
/// webview and then dies at launch. Sonames, not package names: the package providing
/// them is called something different on every RPM distro.
#[test]
fn the_rpm_declares_the_libraries_it_links() {
    let config: serde_json::Value =
        serde_json::from_str(&read(Path::new(MANIFEST_DIR).join("tauri.conf.json")))
            .expect("tauri.conf.json is valid JSON");
    let depends = config["bundle"]["linux"]["rpm"]["depends"]
        .as_array()
        .expect("the rpm bundle declares its runtime dependencies");

    for lib in [
        "libwebkit2gtk-4.1.so.0()(64bit)",
        "libjavascriptcoregtk-4.1.so.0()(64bit)",
        "libgtk-3.so.0()(64bit)",
    ] {
        assert!(
            depends.iter().any(|d| d == lib),
            "the rpm no longer requires {lib} — dnf would install a build that cannot start"
        );
    }
}

/// Windows merges the native caption into the app's single top bar, so the main
/// window's frame must go — but only on Windows: a global `decorations: false`
/// would strip the macOS traffic lights and the Linux native frame too.
#[test]
fn only_the_windows_main_window_drops_the_native_frame() {
    assert!(
        MAIN_RS.contains("#[cfg(windows)]") && MAIN_RS.contains("set_decorations(false)"),
        "the Windows-only set_decorations(false) for the main window is gone — \
         Windows would stack a native title bar above the app's own top bar"
    );
    let config: serde_json::Value =
        serde_json::from_str(&read(Path::new(MANIFEST_DIR).join("tauri.conf.json")))
            .expect("tauri.conf.json is valid JSON");
    assert!(
        config["app"]["windows"][0].get("decorations").is_none(),
        "a global decorations setting in tauri.conf.json would strip the macOS \
         overlay title bar and the Linux native frame"
    );
}

/// The caption buttons' permissions belong to the Windows main window alone;
/// detached panels keep their native frames and must not gain window control.
#[test]
fn caption_permissions_stay_on_the_windows_main_window() {
    let cap: serde_json::Value = serde_json::from_str(&read(
        Path::new(MANIFEST_DIR).join("capabilities/main-window.json"),
    ))
    .expect("main-window.json is valid JSON");
    assert_eq!(cap["windows"], serde_json::json!(["main"]));
    assert_eq!(cap["platforms"], serde_json::json!(["windows"]));
    let permissions = cap["permissions"].as_array().expect("permissions list");
    for needed in [
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-close",
    ] {
        assert!(
            permissions.iter().any(|p| p == needed),
            "the main window capability no longer grants {needed}"
        );
    }
    let default = read(Path::new(MANIFEST_DIR).join("capabilities/default.json"));
    assert!(
        !default.contains("allow-minimize") && !default.contains("allow-toggle-maximize"),
        "caption permissions leaked into the shared capability that also covers panel-*"
    );
}

/// Source contract: all four Windows `NOTIFYICONDATAW` constructions must set `cbSize`.
#[test]
fn windows_tray_icon_sets_cbsize_on_every_notifyicondata() {
    let src = read(
        Path::new(MANIFEST_DIR).join("../../vendor/tray-icon/src/platform_impl/windows/mod.rs"),
    );
    const FIELD: &str = "cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as _";

    // Each construction body ends at its first '}', so a later field cannot satisfy an earlier missing one.
    let construction_ok = |s: &str| {
        let bodies: Vec<&str> = s
            .split("NOTIFYICONDATAW {")
            .skip(1)
            .map(|rest| rest.split_once('}').map(|(b, _)| b).unwrap_or(""))
            .collect();
        bodies.len() == 4 && bodies.iter().all(|b| b.contains(FIELD))
    };

    assert!(
        construction_ok(&src),
        "expected exactly four NOTIFYICONDATAW constructions, each setting cbSize to \
         size_of::<NOTIFYICONDATAW>()"
    );

    // Mutation regression: deleting any single cbSize field must fail the check.
    let fields: Vec<usize> = src.match_indices(FIELD).map(|(i, _)| i).collect();
    assert_eq!(
        fields.len(),
        4,
        "expected exactly four cbSize fields; found {}",
        fields.len()
    );
    for start in fields {
        let mut mutated = src.clone();
        mutated.replace_range(start..start + FIELD.len(), "");
        assert!(
            !construction_ok(&mutated),
            "deleting the cbSize field at byte offset {start} still passes — the \
             mutation regression is not sensitive enough"
        );
    }
}

/// Source contract: the `[patch.crates-io]` entry must point at the vendored copy.
#[test]
fn the_tray_icon_patch_points_at_the_vendored_copy() {
    let manifest = read(Path::new(MANIFEST_DIR).join("../../Cargo.toml"));
    let patch = manifest
        .split_once("[patch.crates-io]")
        .expect("root Cargo.toml declares a [patch.crates-io] section for tray-icon")
        .1;
    assert!(
        patch.contains(r#"tray-icon = { path = "vendor/tray-icon" }"#),
        "the [patch.crates-io] entry for tray-icon no longer points at vendor/tray-icon"
    );
}

/// `--bg` of the dark theme — the single source of truth for the app's backdrop.
fn dark_background_token() -> String {
    let css = read(Path::new(MANIFEST_DIR).join("ui/src/app.css"));
    let block = css
        .split_once(":root[data-theme='dark']")
        .expect("app.css declares a dark theme block")
        .1;
    block[..block.find('}').expect("the dark theme block is closed")]
        .split_once("--bg:")
        .expect("the dark theme block declares --bg")
        .1
        .split(';')
        .next()
        .expect("--bg is terminated")
        .trim()
        .to_lowercase()
}

fn read(path: impl AsRef<Path>) -> String {
    let path = path.as_ref();
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}
