//! Per-host latency, measured from this machine: a TCP connect to the host's SSH (or
//! probe) port, and an ICMP echo — on Windows through the iphlpapi ICMP API (no process
//! spawn, no locale parsing), elsewhere through the system `ping`.
//!
//! The SSH poller's metrics are only for connected hosts; the host list needs numbers
//! for every host, before any login. Both measurements run on a blocking thread so a
//! slow DNS lookup or a `ping` timeout never stalls the runtime, and the results are
//! broadcast as `host-latency` events (tech-gui.md §4.3).

use std::net::{TcpStream, ToSocketAddrs};
#[cfg(not(windows))]
use std::process::Command;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use easyssh_core::ssh::client::Host;

use crate::events::HostLatency;
use crate::state::GuiState;

/// How often every host is measured. Two seconds of timeout plus a round of DNS is the
/// worst case; the list is small enough to measure all hosts in parallel.
const INTERVAL: Duration = Duration::from_secs(10);
const FIRST_DELAY: Duration = Duration::from_secs(3);
const TCP_TIMEOUT: Duration = Duration::from_secs(2);

/// Measures every host once, then keeps measuring until the app exits.
pub async fn run(app: AppHandle) {
    tokio::time::sleep(FIRST_DELAY).await;
    loop {
        let hosts = app
            .try_state::<GuiState>()
            .map(|state| state.host_configs())
            .unwrap_or_default();
        let mut tasks = Vec::with_capacity(hosts.len());
        for host in hosts {
            let app = app.clone();
            tasks.push(tokio::task::spawn_blocking(move || {
                let tcp_ms = tcp_latency(&host);
                let ping_ms = ping_latency(&host.hostname);
                let _ = HostLatency {
                    host_name: host.name,
                    tcp_ms,
                    ping_ms,
                }
                .emit(&app);
            }));
        }
        for task in tasks {
            let _ = task.await;
        }
        tokio::time::sleep(INTERVAL).await;
    }
}

/// Milliseconds to open a TCP connection to the port the app watches for this host: the
/// monitor port when one is set, else SSH's.
fn tcp_latency(host: &Host) -> Option<u32> {
    let port = host.monitor_port.unwrap_or(host.port);
    let mut addrs = (host.hostname.as_str(), port).to_socket_addrs().ok()?;
    let mut best: Option<u32> = None;
    // A name can resolve to several addresses; the fastest reachable one is the host's
    // latency, not the first that happens to answer.
    for addr in addrs.by_ref().take(4) {
        let start = Instant::now();
        if TcpStream::connect_timeout(&addr, TCP_TIMEOUT).is_ok() {
            let ms = u32::try_from(start.elapsed().as_millis()).unwrap_or(u32::MAX);
            best = Some(best.map_or(ms, |current| current.min(ms)));
        }
    }
    best
}

/// Milliseconds for one ICMP echo via iphlpapi: security software (e.g. 360) intercepts
/// console spawns of ping.exe, and the API needs no locale parsing or admin rights.
#[cfg(windows)]
fn ping_latency(hostname: &str) -> Option<u32> {
    use std::net::SocketAddr;

    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY, IP_OPTION_INFORMATION,
    };

    // IPv4 only: IcmpSendEcho takes a v4 address; IPv6-only hosts report no ping.
    let ip = (hostname, 0)
        .to_socket_addrs()
        .ok()?
        .find_map(|addr| match addr {
            SocketAddr::V4(v4) => Some(v4.ip().octets()),
            SocketAddr::V6(_) => None,
        })?;
    // Octets in memory are already network byte order, which is what in_addr wants.
    let dest = u32::from_ne_bytes(ip);
    let payload = [0u8; 32];
    let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + 32 + 8];
    unsafe {
        let handle = IcmpCreateFile();
        if handle == INVALID_HANDLE_VALUE {
            return None;
        }
        let opts = IP_OPTION_INFORMATION {
            Ttl: 64,
            ..std::mem::zeroed()
        };
        let count = IcmpSendEcho(
            handle,
            dest,
            payload.as_ptr().cast(),
            payload.len() as u16,
            &opts,
            reply.as_mut_ptr().cast(),
            reply.len() as u32,
            1500,
        );
        IcmpCloseHandle(handle);
        if count == 0 {
            return None;
        }
        let echo = &*(reply.as_ptr() as *const ICMP_ECHO_REPLY);
        if echo.Status != 0 {
            return None;
        }
        Some(echo.RoundTripTime.max(1))
    }
}

/// Milliseconds for one ICMP echo, from the system `ping`.
#[cfg(not(windows))]
fn ping_latency(hostname: &str) -> Option<u32> {
    let output = ping_command(hostname).output().ok()?;
    // The bytes, not a lossy UTF-8 string: a localised `ping` may print in a legacy code
    // page that `from_utf8_lossy` would turn into replacement characters.
    parse_ping(&output.stdout)
}

#[cfg(not(windows))]
fn ping_command(hostname: &str) -> Command {
    let mut command = Command::new("ping");
    #[cfg(target_os = "macos")]
    {
        command.args(["-c", "1", "-W", "2000", hostname]);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        command.args(["-c", "1", "-W", "2", hostname]);
    }
    command
}

/// The round-trip time a `ping` printed, in whole milliseconds.
///
/// Scans raw bytes so both the English `time=` and the localised `时间=` match, in
/// UTF-8 and in legacy code pages (GBK), where `时间` is `CA B1 BC E4`; a generic
/// `= <number> ms` fallback covers locales without a known marker.
// Windows pings via ICMP, so only tests call this there.
#[cfg_attr(windows, allow(dead_code))]
fn parse_ping(output: &[u8]) -> Option<u32> {
    const GBK_SHI: &[u8] = &[0xCA, 0xB1];
    const GBK_JIAN: &[u8] = &[0xBC, 0xE4];
    let mut markers: Vec<Vec<u8>> = vec![
        b"time=".to_vec(),
        b"time<".to_vec(),
        b"Time=".to_vec(),
        b"Time<".to_vec(),
    ];
    markers.push("时间=".as_bytes().to_vec());
    markers.push("时间<".as_bytes().to_vec());
    let mut gbk = Vec::new();
    gbk.extend_from_slice(GBK_SHI);
    gbk.extend_from_slice(GBK_JIAN);
    let mut gbk_lt = gbk.clone();
    gbk.push(b'=');
    gbk_lt.push(b'<');
    markers.push(gbk);
    markers.push(gbk_lt);

    for marker in markers {
        let Some(at) = output
            .windows(marker.len())
            .position(|window| window == marker.as_slice())
        else {
            continue;
        };
        let rest = &output[at + marker.len()..];
        let digits: Vec<u8> = rest
            .iter()
            .copied()
            .take_while(|byte| byte.is_ascii_digit() || *byte == b'.')
            .collect();
        if let Ok(text) = std::str::from_utf8(&digits) {
            if let Ok(value) = text.parse::<f64>() {
                // `time<1ms` is under a millisecond; report 1 rather than 0.
                return Some((value.ceil() as u32).max(1));
            }
        }
    }

    // Locale-independent fallback: any `= 12 ms` / `<1ms` shape (German `Zeit=`, French
    // `temps=`); requiring the trailing `ms` rejects `bytes=32`, `ttl=64`, `icmp_seq=1`.
    for (at, byte) in output.iter().enumerate() {
        if *byte != b'=' && *byte != b'<' {
            continue;
        }
        let mut rest = &output[at + 1..];
        while rest.first() == Some(&b' ') {
            rest = &rest[1..];
        }
        let digits: Vec<u8> = rest
            .iter()
            .copied()
            .take_while(|byte| byte.is_ascii_digit() || *byte == b'.')
            .collect();
        if digits.is_empty() {
            continue;
        }
        let mut tail = &rest[digits.len()..];
        while tail.first() == Some(&b' ') {
            tail = &tail[1..];
        }
        if !tail.starts_with(b"ms") {
            continue;
        }
        if let Ok(text) = std::str::from_utf8(&digits) {
            if let Ok(value) = text.parse::<f64>() {
                return Some((value.ceil() as u32).max(1));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_ping;

    #[test]
    fn reads_ping_output_in_every_locale() {
        assert_eq!(
            parse_ping(b"Reply from 10.0.0.1: bytes=32 time=12ms TTL=64"),
            Some(12)
        );
        assert_eq!(
            parse_ping(b"64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.412 ms"),
            Some(1)
        );
        assert_eq!(
            parse_ping(b"Reply from 10.0.0.1: bytes=32 time<1ms TTL=64"),
            Some(1)
        );
        assert_eq!(
            parse_ping("来自 10.0.0.1 的回复: 字节=32 时间=15ms TTL=64".as_bytes()),
            Some(15)
        );
        assert_eq!(parse_ping(b"Request timed out."), None);
        assert_eq!(parse_ping(b""), None);
    }

    #[test]
    fn reads_localised_output_without_known_markers() {
        assert_eq!(
            parse_ping(b"64 Bytes von 10.0.0.1: icmp_seq=1 ttl=64 Zeit=12 ms"),
            Some(12)
        );
        assert_eq!(
            parse_ping(b"64 octets de 10.0.0.1 : icmp_seq=1 ttl=64 temps=12 ms"),
            Some(12)
        );
        assert_eq!(parse_ping(b"bytes=32 ttl=64"), None);
        // No reply, only failure text: the fallback must not invent a time.
        assert_eq!(parse_ping(b"Request timed out."), None);
    }

    #[test]
    fn reads_chinese_windows_oem_output() {
        // What `ping` prints on a Chinese Windows, in the GBK bytes the console uses:
        // 来自 ... 时间=15ms. The parser must not need a UTF-8 decode.
        let mut gbk: Vec<u8> = Vec::new();
        for byte in "来自 10.0.0.1 的回复: 字节=32 时间=15ms TTL=64".chars() {
            if byte.is_ascii() {
                gbk.push(byte as u8);
            } else {
                // Encode just the characters the reply needs (时, 间) by known codes.
                gbk.extend_from_slice(match byte {
                    '来' => &[0xC0, 0xB4],
                    '自' => &[0xD7, 0xD4],
                    '的' => &[0xB5, 0xC4],
                    '回' => &[0xBB, 0xD8],
                    '复' => &[0xB8, 0xB4],
                    '字' => &[0xD7, 0xD6],
                    '节' => &[0xBD, 0xDA],
                    '时' => &[0xCA, 0xB1],
                    '间' => &[0xBC, 0xE4],
                    _ => &[0x3F],
                });
            }
        }
        assert_eq!(parse_ping(&gbk), Some(15));
    }
}
