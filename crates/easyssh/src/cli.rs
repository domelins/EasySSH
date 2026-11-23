use clap::Parser;

/// EasySSH — TUI SSH dashboard & server manager.
///
/// Manage all your SSH servers from a single terminal window.
/// Dashboard with live metrics, SFTP file manager, command snippets,
/// and multi-session tabs with split-view.
#[derive(Parser, Debug)]
#[command(
    name = "easy",
    version,
    about = "TUI SSH dashboard & server manager",
    long_about = None,
)]
pub struct Cli {
    /// Path to a custom config file.
    ///
    /// Defaults to ~/.config/easyssh/config.toml (Linux),
    /// ~/Library/Application Support/easyssh/config.toml (macOS),
    /// or %APPDATA%\\easyssh\\config.toml (Windows).
    #[arg(short, long, value_name = "FILE")]
    pub config: Option<std::path::PathBuf>,

    /// Override the color theme (default | dracula | nord | gruvbox).
    ///
    /// The chosen theme is saved to the config file, so it persists on the
    /// next run without the flag.
    #[arg(short, long, value_name = "THEME")]
    pub theme: Option<String>,

    /// Enable verbose debug logging (written to a log file in the config directory).
    #[arg(short, long)]
    pub verbose: bool,
}
