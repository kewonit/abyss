use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Command as StdCommand;
use std::time::{Duration, Instant};
use tauri::Emitter;
#[cfg(debug_assertions)]
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const SCHEMA_VERSION: u32 = 2;
const TICK_MS: u64 = 1000;
const NETSTAT_POLL_MS: u64 = 2000;
const GEO_API: &str = "http://ip-api.com/batch";
const MAX_FLOWS_PER_FRAME: usize = 35;
const GEO_CACHE_MAX_SIZE: usize = 5_000;
const GEO_CACHE_TTL_SECS: u64 = 30 * 60;
const GEO_BACKOFF_MIN_SECS: u64 = 3;
const GEO_BACKOFF_MAX_SECS: u64 = 30;
#[cfg(debug_assertions)]
const PERF_LOG_INTERVAL_SECS: u64 = 10;
const FLOW_GRACE_SECS: u64 = 8;
const MATERIAL_FLOW_DELTA: i32 = 2;
const MATERIAL_THROUGHPUT_DELTA_PCT: f64 = 7.0;
const MATERIAL_MIN_BPS_DELTA: f64 = 900_000.0;
const MATERIAL_LATENCY_DELTA_MS: f64 = 10.0;

#[derive(Clone, Serialize, Debug)]
pub struct GeoEndpoint {
    pub ip: String,
    pub lat: f64,
    pub lng: f64,
    pub city: String,
    pub country: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org: Option<String>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeoFlow {
    pub id: String,
    pub src: GeoEndpoint,
    pub dst: GeoEndpoint,
    pub bps: f64,
    pub pps: u32,
    pub rtt: f64,
    pub protocol: u8,
    pub dir: String,
    pub port: u16,
    pub service: Option<u8>,
    pub started_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

#[derive(Clone, Copy, Serialize, Debug, Default)]
pub struct ProtoCounters {
    pub tcp: u32,
    pub udp: u32,
    pub icmp: u32,
    pub dns: u32,
    pub https: u32,
    pub http: u32,
    pub other: u32,
}

#[derive(Clone, Copy, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NetMetrics {
    pub bps: f64,
    pub pps: u32,
    pub active_flows: u32,
    pub latency_ms: f64,
    pub upload_bps: f64,
    pub download_bps: f64,
}

#[derive(Clone, Serialize, Debug)]
pub struct TelemetryFrame {
    pub schema: u32,
    pub t: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light: Option<bool>,
    pub net: NetMetrics,
    pub proto: ProtoCounters,
    pub flows: Vec<GeoFlow>,
}

#[derive(Clone, Copy)]
struct FrameSnapshot {
    active_flows: u32,
    bps: f64,
    latency_ms: f64,
}

#[derive(Clone)]
struct ParsedConnection {
    proto: String,
    local_ip: String,
    remote_ip: String,
    remote_port: u16,
    state: String,
    pid: u32,
}

#[derive(Clone)]
struct GeoInfo {
    lat: f64,
    lng: f64,
    city: String,
    country: String,
    asn: String,
    org: String,
}

#[derive(Clone)]
struct GeoCacheEntry {
    value: Option<GeoInfo>,
    expires_at: Instant,
    last_access: Instant,
}

#[derive(Default)]
struct PerfStats {
    parse_netstat_ms: f64,
    geolocate_batch_ms: f64,
    build_frame_ms: f64,
    emit_frame_ms: f64,
    ws_payload_bytes: usize,
    cycles: u32,
    ticks: u32,
    geo_cache_hits: u32,
    geo_cache_misses: u32,
}

type GeoTaskResult = (Vec<(String, GeoCacheEntry)>, f64, bool);

struct LocalGeo {
    lat: f64,
    lng: f64,
    city: String,
    country: String,
}

#[derive(Deserialize)]
struct GeoApiItem {
    status: String,
    lat: Option<f64>,
    lon: Option<f64>,
    city: Option<String>,
    #[serde(rename = "countryCode")]
    country_code: Option<String>,
    #[serde(rename = "as")]
    as_field: Option<String>,
    org: Option<String>,
    isp: Option<String>,
}

fn is_private_ip(ip: &str) -> bool {
    ip.starts_with("10.")
        || ip.starts_with("192.168.")
        || (ip.starts_with("172.") && {
            let second: u8 = ip
                .split('.')
                .nth(1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            (16..=31).contains(&second)
        })
        || ip.starts_with("127.")
        || ip.starts_with("0.")
        || ip == "::1"
        || ip == "::"
        || ip.starts_with("fe80:")
        || ip.starts_with("fc00:")
        || ip.starts_with("fd")
        || ip == "*"
        // IPv4-mapped IPv6: ::ffff:10.x, ::ffff:192.168.x, etc.
        || (ip.starts_with("::ffff:") && {
            let v4 = &ip[7..];
            is_private_ip(v4)
        })
}

fn split_address(addr: &str) -> (String, u16) {
    // Handle IPv6 in brackets: [::1]:443
    if let Some(rest) = addr.strip_prefix('[') {
        if let Some(close) = rest.find(']') {
            let ip = rest[..close].to_string();
            let port = rest
                .get(close + 2..) // skip "]:" 
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            return (ip, port);
        }
        // Malformed bracket — return as-is
        return (addr.to_string(), 0);
    }
    // Count colons to distinguish IPv6 (bare, no brackets) from IPv4
    let colon_count = addr.chars().filter(|&c| c == ':').count();
    if colon_count > 1 {
        // Bare IPv6 without brackets — last colon separates port
        if let Some(pos) = addr.rfind(':') {
            // Only treat as port if what follows is a valid u16
            if let Ok(port) = addr[pos + 1..].parse::<u16>() {
                return (addr[..pos].to_string(), port);
            }
        }
        // No valid port found — entire string is the IP
        return (addr.to_string(), 0);
    }
    // IPv4: last colon separates port
    if let Some(pos) = addr.rfind(':') {
        let ip = addr[..pos].to_string();
        let port = addr[pos + 1..].parse().unwrap_or(0);
        return (ip, port);
    }
    (addr.to_string(), 0)
}

fn protocol_code(proto: &str) -> u8 {
    match proto {
        "tcp" => 1,
        "udp" => 2,
        "icmp" => 3,
        _ => 0,
    }
}

fn service_code(port: u16) -> Option<u8> {
    match port {
        21 => Some(1),
        22 => Some(2),
        25 => Some(3),
        53 => Some(4),
        80 => Some(5),
        110 => Some(6),
        143 => Some(7),
        443 => Some(8),
        465 => Some(9),
        587 => Some(10),
        993 => Some(11),
        995 => Some(12),
        1433 => Some(13),
        3306 => Some(14),
        3389 => Some(15),
        5432 => Some(16),
        5900 => Some(17),
        6379 => Some(18),
        8080 => Some(19),
        8443 => Some(20),
        27017 => Some(21),
        9090 => Some(22),
        _ => None,
    }
}

fn parse_netstat() -> Vec<ParsedConnection> {
    let mut cmd = StdCommand::new("netstat");
    cmd.args(["-no"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = match cmd.output() {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            eprintln!("[Abyss] netstat exited with status {}", o.status);
            return vec![];
        }
        Err(e) => {
            eprintln!("[Abyss] netstat failed: {e}");
            return vec![];
        }
    };

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut connections = Vec::with_capacity(256);

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }

        let proto_upper = parts[0].to_uppercase();
        if proto_upper != "TCP" && proto_upper != "UDP" {
            continue;
        }

        let (local_ip, _local_port) = split_address(parts[1]);
        let (remote_ip, remote_port) = split_address(parts[2]);

        // TCP has state field, UDP does not (PID may shift position)
        let (state, pid) = if proto_upper == "TCP" {
            let st = parts.get(3).copied().unwrap_or("").to_string();
            let p: u32 = parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0);
            (st, p)
        } else {
            // UDP: parts[3] is PID directly
            let p: u32 = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
            ("STATELESS".to_string(), p)
        };

        if remote_ip == "*" || remote_ip == "0.0.0.0" || remote_ip == "[::]" || remote_ip.is_empty() {
            continue;
        }
        if is_private_ip(&remote_ip) {
            continue;
        }

        connections.push(ParsedConnection {
            proto: proto_upper.to_lowercase(),
            local_ip,
            remote_ip,
            remote_port,
            state,
            pid,
        });
    }

    connections
}

const PROCESS_CACHE_TTL_SECS: u64 = 10;

fn resolve_process_names() -> HashMap<u32, String> {
    let mut cmd = StdCommand::new("tasklist");
    cmd.args(["/FO", "CSV", "/NH"]);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return HashMap::new(),
    };

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut map = HashMap::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Format: "name.exe","1234","Console","1","12,345 K"
        let mut fields = Vec::new();
        let mut in_quote = false;
        let mut field = String::new();
        for ch in trimmed.chars() {
            match ch {
                '"' => in_quote = !in_quote,
                ',' if !in_quote => {
                    fields.push(std::mem::take(&mut field));
                    if fields.len() >= 2 {
                        break;
                    }
                }
                _ => field.push(ch),
            }
        }
        if !field.is_empty() {
            fields.push(field);
        }
        if fields.len() >= 2 {
            if let Ok(pid) = fields[1].trim().parse::<u32>() {
                let name = fields[0].trim().to_string();
                if !name.is_empty() && pid > 0 {
                    map.insert(pid, name);
                }
            }
        }
    }

    map
}

async fn detect_local_geo(client: &reqwest::Client) -> LocalGeo {
    if let Ok(resp) = client
        .get("http://ip-api.com/json/?fields=lat,lon,city,countryCode")
        .send()
        .await
    {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            return LocalGeo {
                lat: data["lat"].as_f64().unwrap_or(40.71),
                lng: data["lon"].as_f64().unwrap_or(-74.01),
                city: data["city"]
                    .as_str()
                    .unwrap_or("Unknown")
                    .to_string(),
                country: data["countryCode"]
                    .as_str()
                    .unwrap_or("US")
                    .to_string(),
            };
        }
    }
    LocalGeo {
        lat: 40.71,
        lng: -74.01,
        city: "Unknown".into(),
        country: "US".into(),
    }
}

async fn geolocate_batch(
    client: reqwest::Client,
    ips: Vec<String>,
) -> (Vec<(String, GeoCacheEntry)>, bool) {
    if ips.is_empty() {
        return (Vec::new(), true);
    }

    let batch: Vec<String> = ips.into_iter().take(100).collect();
    let body: Vec<serde_json::Value> = batch
        .iter()
        .map(|ip| {
            serde_json::json!({
                "query": ip,
                "fields": "status,lat,lon,city,countryCode,as,org,isp"
            })
        })
        .collect();

    let mut updates = Vec::with_capacity(batch.len());
    let mut success = false;

    match client.post(GEO_API).json(&body).send().await {
        Ok(resp) => {
            // Handle rate limiting (HTTP 429)
            if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                eprintln!("[Abyss] GeoIP rate limited (429) — will retry with backoff");
                return (Vec::new(), false);
            }
            if !resp.status().is_success() {
                eprintln!("[Abyss] GeoIP batch HTTP {}", resp.status());
                return (Vec::new(), false);
            }
            if let Ok(results) = resp.json::<Vec<GeoApiItem>>().await {
                success = true;
                for (i, r) in results.iter().enumerate() {
                    if i >= batch.len() {
                        break;
                    }
                    if r.status == "success" {
                        // ip-api "as" field looks like "AS15169 Google LLC" — extract just the AS number
                        let asn_raw = r.as_field.clone().unwrap_or_default();
                        let asn = asn_raw
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .to_string();
                        // Prefer org over isp, trim whitespace
                        let org = r
                            .org
                            .clone()
                            .or_else(|| r.isp.clone())
                            .map(|s| s.trim().to_string())
                            .unwrap_or_default();
                        updates.push((
                            batch[i].clone(),
                            GeoCacheEntry {
                                value: Some(GeoInfo {
                                    lat: r.lat.unwrap_or(0.0),
                                    lng: r.lon.unwrap_or(0.0),
                                    city: r.city.clone().unwrap_or_else(|| "Unknown".into()),
                                    country: r
                                        .country_code
                                        .clone()
                                        .unwrap_or_else(|| "??".into()),
                                    asn,
                                    org,
                                }),
                                expires_at: Instant::now() + Duration::from_secs(GEO_CACHE_TTL_SECS),
                                last_access: Instant::now(),
                            },
                        ));
                    } else {
                        updates.push((
                            batch[i].clone(),
                            GeoCacheEntry {
                                value: None,
                                expires_at: Instant::now() + Duration::from_secs(GEO_CACHE_TTL_SECS),
                                last_access: Instant::now(),
                            },
                        ));
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("[Abyss] GeoIP batch failed: {e}");
        }
    }

    (updates, success)
}

fn prune_geo_cache(cache: &mut HashMap<String, GeoCacheEntry>) {
    let now = Instant::now();
    cache.retain(|_, entry| entry.expires_at > now);

    if cache.len() <= GEO_CACHE_MAX_SIZE {
        return;
    }

    // Use partial sort (select_nth) to find the Nth oldest entry's cutoff time,
    // then retain only entries newer than that. Avoids a full O(n log n) sort.
    let remove_count = cache.len() - GEO_CACHE_MAX_SIZE;
    let mut access_times: Vec<Instant> = cache.values().map(|e| e.last_access).collect();
    // partition so access_times[remove_count - 1] is the remove_count-th oldest
    access_times.select_nth_unstable(remove_count - 1);
    let cutoff = access_times[remove_count - 1];

    let mut removed = 0;
    cache.retain(|_, entry| {
        if removed >= remove_count {
            return true;
        }
        if entry.last_access <= cutoff {
            removed += 1;
            return false;
        }
        true
    });
}

fn get_geo_cached<'a>(
    cache: &'a mut HashMap<String, GeoCacheEntry>,
    ip: &str,
    perf: &mut PerfStats,
) -> Option<&'a GeoInfo> {
    let now = Instant::now();
    if cache
        .get(ip)
        .map(|entry| entry.expires_at <= now)
        .unwrap_or(false)
    {
        cache.remove(ip);
        perf.geo_cache_misses += 1;
        return None;
    }

    if let Some(entry) = cache.get_mut(ip) {
        entry.last_access = now;
        perf.geo_cache_hits += 1;
        return entry.value.as_ref();
    }

    perf.geo_cache_misses += 1;
    None
}

#[allow(clippy::too_many_arguments)]
fn build_frame(
    connections: &[ParsedConnection],
    geo_cache: &mut HashMap<String, GeoCacheEntry>,
    prev_keys: &mut HashSet<String>,
    local: &LocalGeo,
    elapsed: f64,
    perf: &mut PerfStats,
    process_names: &HashMap<u32, String>,
    flow_first_seen: &mut HashMap<String, f64>,
) -> TelemetryFrame {
    let round2 = |v: f64| (v * 100.0).round() / 100.0;
    let fnv1a = |s: &str| -> u32 {
        let mut h: u32 = 2_166_136_261;
        for b in s.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(16_777_619);
        }
        h
    };

    let mut flow_map: HashMap<String, &ParsedConnection> = HashMap::with_capacity(connections.len());
    for conn in connections {
        // Build key without format! — avoids extra allocation from formatting machinery
        let mut key = String::with_capacity(conn.remote_ip.len() + 12);
        key.push_str(&conn.remote_ip);
        key.push(':');
        // itoa-style inline for port
        let port_str: [u8; 5];
        let port_len = {
            let mut n = conn.remote_port;
            let mut buf = [0u8; 5];
            let mut i = 5;
            if n == 0 { i -= 1; buf[i] = b'0'; } else {
                while n > 0 { i -= 1; buf[i] = b'0' + (n % 10) as u8; n /= 10; }
            }
            port_str = buf;
            5 - i
        };
        key.push_str(unsafe { std::str::from_utf8_unchecked(&port_str[5-port_len..]) });
        key.push(':');
        key.push_str(&conn.proto);
        flow_map.entry(key).or_insert(conn);
    }

    let mut flows = Vec::with_capacity(flow_map.len().min(MAX_FLOWS_PER_FRAME));
    let mut proto = ProtoCounters::default();
    let mut total_up: f64 = 0.0;
    let mut total_down: f64 = 0.0;

    for (key, conn) in &flow_map {
        let geo = match get_geo_cached(geo_cache, &conn.remote_ip, perf) {
            Some(g) => g,
            _ => continue,
        };

        let base_bps: f64 = match conn.remote_port {
            443 => 50_000.0,
            80 => 30_000.0,
            53 => 500.0,
            22 => 5_000.0,
            _ => 10_000.0,
        };

        let existed = prev_keys.contains(key);
        let key_hash = fnv1a(key);
        let bps_factor = if existed {
            0.7 + (key_hash % 60) as f64 / 100.0
        } else {
            2.0
        };
        let estimated_bps = base_bps * bps_factor;

        let dir = if conn.state == "ESTABLISHED" || conn.state == "STATELESS" {
            if key_hash % 2 == 0 {
                "up"
            } else {
                "down"
            }
        } else {
            "bidi"
        };

        let process_name = if conn.pid > 0 {
            process_names.get(&conn.pid).cloned()
        } else {
            None
        };

        let first_seen = *flow_first_seen.entry(key.clone()).or_insert(elapsed);

        flows.push(GeoFlow {
            id: format!("live-{key}"),
            src: GeoEndpoint {
                ip: conn.local_ip.clone(),
                lat: local.lat,
                lng: local.lng,
                city: local.city.clone(),
                country: local.country.clone(),
                asn: None,
                org: None,
            },
            dst: GeoEndpoint {
                ip: conn.remote_ip.clone(),
                lat: round2(geo.lat),
                lng: round2(geo.lng),
                city: geo.city.clone(),
                country: geo.country.clone(),
                asn: if !geo.asn.is_empty() { Some(geo.asn.clone()) } else { None },
                org: if !geo.org.is_empty() { Some(geo.org.clone()) } else { None },
            },
            bps: (estimated_bps / 10.0).round() * 10.0,
            pps: (estimated_bps / 1000.0).max(1.0) as u32,
            rtt: round2(10.0 + (key_hash % 600) as f64 / 10.0),
            protocol: protocol_code(&conn.proto),
            dir: dir.to_string(),
            port: conn.remote_port,
            service: service_code(conn.remote_port),
            started_at: first_seen,
            process: process_name,
            pid: if conn.pid > 0 { Some(conn.pid) } else { None },
            state: if !conn.state.is_empty() && conn.state != "STATELESS" { Some(conn.state.clone()) } else { None },
        });

        match conn.remote_port {
            443 => proto.https += 1,
            80 => proto.http += 1,
            53 => proto.dns += 1,
            _ => {}
        }
        match conn.proto.as_str() {
            "tcp" => proto.tcp += 1,
            "udp" => proto.udp += 1,
            _ => proto.other += 1,
        }

        if dir == "up" {
            total_up += estimated_bps;
        } else {
            total_down += estimated_bps;
        }
    }

    prev_keys.clear();
    for key in flow_map.keys() {
        prev_keys.insert(key.clone());
    }

    flow_first_seen.retain(|k, _| prev_keys.contains(k));

    let total_bps = total_up + total_down;
    let total_pps: u32 = flows.iter().map(|f| f.pps).sum();
    let avg_rtt = if flows.is_empty() {
        0.0
    } else {
        flows.iter().map(|f| f.rtt).sum::<f64>() / flows.len() as f64
    };

    let active_flow_count = flows.len() as u32;
    flows.truncate(MAX_FLOWS_PER_FRAME);

    TelemetryFrame {
        schema: SCHEMA_VERSION,
        t: elapsed,
        light: None,
        net: NetMetrics {
            bps: total_bps,
            pps: total_pps,
            active_flows: active_flow_count,
            latency_ms: avg_rtt,
            upload_bps: total_up,
            download_bps: total_down,
        },
        proto,
        flows,
    }
}

fn is_material_change(prev: Option<FrameSnapshot>, next: &TelemetryFrame) -> bool {
    let Some(previous) = prev else {
        return true;
    };

    let flow_delta = previous.active_flows as i32 - next.net.active_flows as i32;
    if flow_delta.abs() >= MATERIAL_FLOW_DELTA {
        return true;
    }

    let baseline_bps = previous.bps.max(1.0);
    let throughput_abs_delta = (next.net.bps - previous.bps).abs();
    let throughput_delta_pct = (throughput_abs_delta / baseline_bps) * 100.0;
    if throughput_abs_delta >= MATERIAL_MIN_BPS_DELTA
        && throughput_delta_pct >= MATERIAL_THROUGHPUT_DELTA_PCT
    {
        return true;
    }

    (next.net.latency_ms - previous.latency_ms).abs() >= MATERIAL_LATENCY_DELTA_MS
}

async fn monitor_loop(app: tauri::AppHandle) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    println!("[Abyss] Detecting local geo position...");
    let local_geo = detect_local_geo(&client).await;
    println!(
        "[Abyss] Local: {}, {} ({:.2}, {:.2})",
        local_geo.city, local_geo.country, local_geo.lat, local_geo.lng
    );

    let mut geo_cache: HashMap<String, GeoCacheEntry> = HashMap::with_capacity(256);
    let mut prev_keys: HashSet<String> = HashSet::with_capacity(64);
    let start = Instant::now();
    let mut last_geo_lookup = Instant::now() - Duration::from_secs(10);
    let mut geo_task: Option<tokio::task::JoinHandle<GeoTaskResult>> = None;
    let mut geo_failures: u32 = 0;
    let mut geo_backoff_until: Option<Instant> = None;
    let mut last_netstat_poll = Instant::now() - Duration::from_millis(NETSTAT_POLL_MS);
    let mut cached_connections: Vec<ParsedConnection> = Vec::new();
    #[cfg(debug_assertions)]
    let mut last_perf_log = Instant::now();
    let mut last_snapshot: Option<FrameSnapshot> = None;
    let mut perf = PerfStats::default();
    let mut flow_presence: HashMap<String, (ParsedConnection, Instant)> = HashMap::new();
    let mut process_names: HashMap<u32, String> = HashMap::new();
    let mut last_process_refresh = Instant::now() - Duration::from_secs(PROCESS_CACHE_TTL_SECS + 1);
    let mut flow_first_seen: HashMap<String, f64> = HashMap::new();

    println!("[Abyss] Monitor started — emitting telemetry-frame events @ 1 Hz");

    loop {
        perf.cycles += 1;
        let connections: Vec<ParsedConnection> =
            if last_netstat_poll.elapsed() >= Duration::from_millis(NETSTAT_POLL_MS) {
                let parse_started = Instant::now();
                let parsed: Vec<ParsedConnection> = tokio::task::spawn_blocking(parse_netstat)
                    .await
                    .unwrap_or_default();
                perf.parse_netstat_ms += parse_started.elapsed().as_secs_f64() * 1000.0;
                cached_connections = parsed;
                last_netstat_poll = Instant::now();
                cached_connections.clone()
            } else {
                cached_connections.clone()
            };

        prune_geo_cache(&mut geo_cache);

        if let Some(task) = geo_task.take() {
            if task.is_finished() {
                match task.await {
                    Ok((updates, elapsed_ms, success)) => {
                        for (ip, entry) in updates {
                            geo_cache.insert(ip, entry);
                        }
                        if success {
                            geo_failures = 0;
                            geo_backoff_until = None;
                        } else {
                            geo_failures = geo_failures.saturating_add(1);
                            let backoff_secs = (GEO_BACKOFF_MIN_SECS
                                * 2_u64.pow(geo_failures.saturating_sub(1).min(4)))
                            .min(GEO_BACKOFF_MAX_SECS);
                            geo_backoff_until = Some(
                                Instant::now() + Duration::from_secs(backoff_secs),
                            );
                        }
                        perf.geolocate_batch_ms += elapsed_ms;
                    }
                    Err(e) => {
                        eprintln!("[Abyss] Geo task join failed: {e}");
                        geo_failures = geo_failures.saturating_add(1);
                        let backoff_secs = (GEO_BACKOFF_MIN_SECS
                            * 2_u64.pow(geo_failures.saturating_sub(1).min(4)))
                        .min(GEO_BACKOFF_MAX_SECS);
                        geo_backoff_until =
                            Some(Instant::now() + Duration::from_secs(backoff_secs));
                    }
                }
            } else {
                geo_task = Some(task);
            }
        }

        let geo_backoff_active = geo_backoff_until
            .map(|until| until > Instant::now())
            .unwrap_or(false);

        if geo_task.is_none()
            && !geo_backoff_active
            && last_geo_lookup.elapsed() > Duration::from_secs(3)
        {
            let now = Instant::now();
            let remote_ips: Vec<String> = connections
                .iter()
                .map(|c| c.remote_ip.clone())
                .collect::<HashSet<_>>()
                .into_iter()
                .filter(|ip| {
                    !is_private_ip(ip)
                        && !geo_cache
                            .get(ip)
                            .map(|entry| entry.expires_at > now)
                            .unwrap_or(false)
                })
                .take(100)
                .collect();

            if !remote_ips.is_empty() {
                let client_clone = client.clone();
                geo_task = Some(tokio::spawn(async move {
                    let started = Instant::now();
                    let (updates, success) = geolocate_batch(client_clone, remote_ips).await;
                    (updates, started.elapsed().as_secs_f64() * 1000.0, success)
                }));
            }
            last_geo_lookup = Instant::now();
        }

        // Flow presence smoothing: keep recently-seen connections visible
        let presence_now = Instant::now();
        for conn in &connections {
            let key = format!("{}:{}:{}", conn.remote_ip, conn.remote_port, conn.proto);
            flow_presence.insert(key, (conn.clone(), presence_now));
        }
        flow_presence.retain(|_, (_, last_seen)| {
            presence_now.duration_since(*last_seen) < Duration::from_secs(FLOW_GRACE_SECS)
        });
        let stable_connections: Vec<ParsedConnection> =
            flow_presence.values().map(|(conn, _)| conn.clone()).collect();

        if last_process_refresh.elapsed() >= Duration::from_secs(PROCESS_CACHE_TTL_SECS) {
            process_names = tokio::task::spawn_blocking(resolve_process_names)
                .await
                .unwrap_or_default();
            last_process_refresh = Instant::now();
        }

        let build_started = Instant::now();
        let frame = build_frame(
            &stable_connections,
            &mut geo_cache,
            &mut prev_keys,
            &local_geo,
            start.elapsed().as_secs_f64(),
            &mut perf,
            &process_names,
            &mut flow_first_seen,
        );
        perf.build_frame_ms += build_started.elapsed().as_secs_f64() * 1000.0;

        let material = is_material_change(last_snapshot, &frame);
        let should_emit_heartbeat = !material;

        if material {
            let emit_started = Instant::now();
            // Compute payload size BEFORE emit to avoid double serialization
            if cfg!(debug_assertions) {
                perf.ws_payload_bytes += serde_json::to_vec(&frame).map_or(0, |v| v.len());
            }
            let _ = app.emit("telemetry-frame", &frame);
            perf.emit_frame_ms += emit_started.elapsed().as_secs_f64() * 1000.0;
            last_snapshot = Some(FrameSnapshot {
                active_flows: frame.net.active_flows,
                bps: frame.net.bps,
                latency_ms: frame.net.latency_ms,
            });
            perf.ticks += 1;
        } else if should_emit_heartbeat {
            // Build heartbeat directly without cloning flows vec
            let heartbeat = TelemetryFrame {
                schema: frame.schema,
                t: frame.t,
                light: Some(true),
                net: frame.net,
                proto: frame.proto,
                flows: Vec::new(),
            };

            let emit_started = Instant::now();
            if cfg!(debug_assertions) {
                perf.ws_payload_bytes += serde_json::to_vec(&heartbeat).map_or(0, |v| v.len());
            }
            let _ = app.emit("telemetry-frame", &heartbeat);
            perf.emit_frame_ms += emit_started.elapsed().as_secs_f64() * 1000.0;
            perf.ticks += 1;
        }

        #[cfg(debug_assertions)]
        {
            let flow_count = frame.flows.len();
            if flow_count > 0 {
                let mbps = (frame.net.bps * 8.0) / 1_000_000.0;
                println!(
                    "[Abyss] {} flows | {:.1} Mbps | {} geo cached",
                    flow_count, mbps, geo_cache.len()
                );
            }

            if last_perf_log.elapsed() >= Duration::from_secs(PERF_LOG_INTERVAL_SECS)
                && perf.cycles > 0
            {
                let cycles = perf.cycles as f64;
                let ticks = perf.ticks.max(1) as f64;
                let hit_total = perf.geo_cache_hits + perf.geo_cache_misses;
                let hit_rate = if hit_total > 0 {
                    (perf.geo_cache_hits as f64 * 100.0) / hit_total as f64
                } else {
                    0.0
                };
                println!(
                    "[Abyss][perf] parse={:.1}ms geo={:.1}ms build={:.1}ms emit={:.1}ms payload={:.1}KB hit={:.1}% cache={}",
                    perf.parse_netstat_ms / cycles,
                    perf.geolocate_batch_ms / cycles,
                    perf.build_frame_ms / cycles,
                    perf.emit_frame_ms / ticks,
                    perf.ws_payload_bytes as f64 / ticks / 1024.0,
                    hit_rate,
                    geo_cache.len()
                );

                perf = PerfStats::default();
                last_perf_log = Instant::now();
            }
        }

        tokio::time::sleep(Duration::from_millis(TICK_MS)).await;
    }
}

#[tauri::command]
async fn fetch_cables() -> Result<String, String> {
    let url = "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json";
    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Cable fetch failed with status {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    #[cfg(debug_assertions)]
    println!("[Abyss] Fetched submarine cable data ({} bytes)", text.len());
    Ok(text)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_cables])
        .setup(|app| {
            println!("╔════════════════════════════════════════╗");
            println!("║   ABYSS — Live Network Monitor         ║");
            println!("╚════════════════════════════════════════╝");

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                monitor_loop(handle).await;
            });

            #[cfg(debug_assertions)]
            {
                let window = app
                    .get_webview_window("main")
                    .expect("Failed to get main window");
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to run Abyss application");
}
