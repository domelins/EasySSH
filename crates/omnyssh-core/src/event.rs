//! Domain events and their payload types.
//!
//! Background tasks (metrics poller, SFTP, PTY sessions, discovery, the
//! update checker) report back to the frontend by sending [`CoreEvent`]
//! values over an `mpsc` channel. Frontends wrap these into their own event
//! type alongside input events.

use std::time::Instant;

use crate::config::snippets::Snippet;
use crate::ssh::client::{ConnectionStatus, Host};
use crate::ssh::key_setup::KeySetupStep;
use crate::ssh::sftp::FileEntry;
use crate::ssh::tunnel::TunnelStatus;

/// Placeholder type aliases for future stages.
/// `HostId` is the host's `name` field — stable, human-readable key.
pub type HostId = String;
pub type SessionId = u64;
pub type TransferId = u64;

/// A single process entry for the "top processes" panel.
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    /// Process / command name.
    pub name: String,
    /// CPU usage percentage.
    pub cpu_percent: f64,
    /// Memory usage percentage.
    pub mem_percent: f64,
}

/// One row of the full process list: the identity a user can act on (PID and
/// command line) plus the two percentages the table sorts by.
#[derive(Debug, Clone)]
pub struct ProcessEntry {
    pub pid: u32,
    /// The command column, spaces included (the kernel's `comm`, not argv).
    pub command: String,
    pub cpu_percent: f64,
    pub mem_percent: f64,
}

/// Memory as the kernel accounts it, in bytes. `used` is what the running
/// workload holds (total minus available), `cached` is the reclaimable page and
/// buffer cache, and `free` is what nobody claims at all — the three sum to
/// `total`. The breakdown is Linux-only today; other platforms report only the
/// percentage in [`Metrics::ram_percent`].
#[derive(Debug, Clone, Default)]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub cached_bytes: u64,
    pub free_bytes: u64,
    /// The kernel's own estimate of what a new allocation can get without
    /// swapping; `None` on kernels too old to expose `MemAvailable`.
    pub available_bytes: Option<u64>,
}

/// Interface traffic for a host, summed over every interface but loopback.
/// The totals are the counters the kernel reports; the rates are the deltas
/// between consecutive samples, so the first sample of a connection has none.
#[derive(Debug, Clone, Default)]
pub struct NetworkInfo {
    pub rx_bytes_total: u64,
    pub tx_bytes_total: u64,
    pub rx_bytes_per_sec: f64,
    pub tx_bytes_per_sec: f64,
}

/// One mounted file system, with I/O rates when its block device can be
/// matched to the host's disk counters. Pseudo file systems (tmpfs, proc, …)
/// are filtered out: they carry no storage a user would act on.
#[derive(Debug, Clone, Default)]
pub struct DiskUsage {
    pub mount: String,
    /// The `Filesystem` column (`/dev/sda1`, `overlay`, …), kept so the row can
    /// explain where its I/O rates come from, when it has any.
    pub device: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub percent: f64,
    /// Read/write throughput since the previous sample; `None` when the device
    /// cannot be matched (a mapper volume, a network share) or on the first sample.
    pub read_bytes_per_sec: Option<f64>,
    pub write_bytes_per_sec: Option<f64>,
}

/// Live metrics collected from a remote server.
#[derive(Debug, Clone)]
pub struct Metrics {
    pub cpu_percent: Option<f64>,
    pub ram_percent: Option<f64>,
    pub disk_percent: Option<f64>,
    pub uptime: Option<String>,
    pub load_avg: Option<String>,
    /// OS information (e.g., "Ubuntu 22.04 LTS", "Debian GNU/Linux 11").
    pub os_info: Option<String>,
    /// Top processes by CPU usage (at most 3).
    pub top_processes: Option<Vec<ProcessInfo>>,
    /// The fuller process table (up to 60 rows), sorted by CPU on the host.
    /// Empty when the host has no usable `ps`.
    pub processes: Vec<ProcessEntry>,
    /// Memory in bytes, with the cache/used/free split when the host exposes it.
    pub memory: Option<MemoryInfo>,
    /// Aggregate network throughput and totals.
    pub network: Option<NetworkInfo>,
    /// One row per real mount, widest first.
    pub disks: Vec<DiskUsage>,
    /// The CPU percentage of the last samples of this poller, oldest first, so
    /// the panel can draw a trend without a second round trip.
    pub cpu_history: Vec<f64>,
    /// When these metrics were last successfully collected.
    pub last_updated: Instant,
}

impl Default for Metrics {
    fn default() -> Self {
        Self {
            cpu_percent: None,
            ram_percent: None,
            disk_percent: None,
            uptime: None,
            load_avg: None,
            os_info: None,
            top_processes: None,
            processes: Vec::new(),
            memory: None,
            network: None,
            disks: Vec::new(),
            cpu_history: Vec::new(),
            last_updated: Instant::now(),
        }
    }
}

/// Domain events produced by the SSH engine, config loaders, and the update
/// checker. Background tasks send these over a dedicated channel; the
/// frontend wraps them into its own event stream.
#[derive(Debug)]
pub enum CoreEvent {
    /// SSH metrics received from a background task.
    MetricsUpdate(HostId, Metrics),
    /// Connection status changed for a host (reported by metrics poller).
    HostStatusChanged(HostId, ConnectionStatus),
    /// File transfer progress: (transfer_id, bytes_done, bytes_total).
    FileTransferProgress(TransferId, u64, u64),
    /// An error message surfaced to the user.
    Error(String),
    /// Host list loaded from disk / SSH config in a background task.
    HostsLoaded(Vec<Host>),
    /// Snippet list loaded from disk in a background task.
    SnippetsLoaded(Vec<Snippet>),
    /// Result of executing a snippet or quick-execute command on one host.
    /// `output` is `Ok(stdout)` or `Err(error_message)`.
    SnippetResult {
        host_name: String,
        snippet_name: String,
        output: Result<String, String>,
    },

    // -----------------------------------------------------------------------
    // File Manager events
    // -----------------------------------------------------------------------
    /// Remote directory listing completed.
    FileDirListed {
        path: String,
        entries: Vec<FileEntry>,
    },
    /// Local directory listing completed.
    LocalDirListed {
        path: String,
        entries: Vec<FileEntry>,
    },
    /// SFTP session successfully established.
    SftpConnected { host_name: String },
    /// SFTP manager ready with established connection (contains SftpManager handle).
    SftpManagerReady {
        host_name: String,
        manager: Box<crate::ssh::sftp::SftpManager>,
    },
    /// SFTP session closed or failed.
    SftpDisconnected { reason: String },
    /// Preview bytes available for a file.
    FilePreviewReady { path: String, content: String },
    /// The full text of a remote file for the editor (`Ok`), or why it cannot be
    /// edited here (`Err`: too large, not UTF-8, permission). The GUI stamps it with
    /// the session id before forwarding it.
    FileContent {
        path: String,
        result: Result<String, String>,
    },
    /// A mutating SFTP operation (delete, mkdir, rename, upload, download, save) finished.
    SftpOpDone { result: Result<(), String> },

    // -----------------------------------------------------------------------
    // PTY multi-session terminal events
    // -----------------------------------------------------------------------
    /// A PTY session produced output. The bytes are already parsed into the
    /// session's `Arc<Mutex<vt100::Parser>>`; this event is a lightweight
    /// render-nudge so the main loop can update `has_activity` state without
    /// copying bulk output data through the channel.
    PtyOutput(SessionId),
    /// The PTY child process exited (reader thread reached EOF or I/O error).
    PtyExited(SessionId),

    // -----------------------------------------------------------------------
    // Smart Server Context — Discovery events
    // -----------------------------------------------------------------------
    /// Quick scan completed for a host, services detected.
    DiscoveryQuickScanDone(HostId, Vec<DetectedService>),
    /// Discovery failed for a host with an error message.
    DiscoveryFailed(HostId, String),

    // -----------------------------------------------------------------------
    // Port forwarding
    // -----------------------------------------------------------------------
    /// A host's tunnel changed state.
    TunnelStatusChanged(HostId, TunnelStatus),

    // -----------------------------------------------------------------------
    // Auto SSH Key Setup events
    // -----------------------------------------------------------------------
    /// Progress update from key setup (host_id, current step, total steps).
    KeySetupProgress(HostId, KeySetupStep),
    /// Key setup completed successfully (host_id, private_key_path).
    KeySetupComplete(HostId, std::path::PathBuf),
    /// Key setup failed with an error (host_id, error_message).
    KeySetupFailed(HostId, String),
    /// Emergency rollback was triggered (host_id, rollback_result).
    KeySetupRollback(HostId, String),
    /// Key login works, but password login stayed on: changing the server's
    /// settings needs sudo without a password (host_id, private_key_path).
    KeySetupPartial(HostId, std::path::PathBuf),
    /// Key setup failed and the server's password login may be off: the
    /// rollback failed or the disable step never answered (host_id, error_message).
    KeySetupFailedUnsafe(HostId, String),

    /// A private key is encrypted and no passphrase is cached for it yet.
    /// Frontends prompt once per key path and call [`crate::ssh::identity::unlock`].
    KeyPassphraseRequired { host_name: HostId, key_path: String },
    /// A connection to `host_name` waits for the login password of `login`
    /// (`user@host`). Frontends answer with [`crate::ssh::password::answer`];
    /// `retry` says the previous one was refused, and `new_host_key` is the
    /// fingerprint of a host key first seen on this connection.
    PasswordRequired {
        request_id: u64,
        host_name: HostId,
        login: String,
        retry: bool,
        new_host_key: Option<String>,
    },

    // -----------------------------------------------------------------------
    // Update checker events
    // -----------------------------------------------------------------------
    /// A newer release was found on GitHub at startup.
    UpdateAvailable(crate::update::UpdateInfo),
    /// A self-update finished — `Ok` on success, `Err` with a message on failure.
    UpdateInstalled(Result<(), String>),
}

// ---------------------------------------------------------------------------
// Smart Server Context — Data structures
// ---------------------------------------------------------------------------

/// Describes a service detected on a remote server.
#[derive(Debug, Clone)]
pub struct DetectedService {
    pub kind: ServiceKind,
    pub metrics: Vec<ServiceMetric>,
}

/// Type of service detected on the server.
/// Only 5 core services are supported: Docker, Nginx, PostgreSQL, Redis, Node.js.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ServiceKind {
    Docker,
    Nginx,
    PostgreSQL,
    Redis,
    NodeJS,
}

/// A metric collected from a specific service.
#[derive(Debug, Clone)]
pub struct ServiceMetric {
    pub name: String,       // e.g., "containers_running"
    pub value: MetricValue, // Typed value
}

/// Typed metric value.
#[derive(Debug, Clone)]
pub enum MetricValue {
    Integer(i64),
}
