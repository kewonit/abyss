use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Command as StdCommand;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const SCHEMA_VERSION: u32 = 2;
const TICK_MS: u64 = 1000;
const GEO_API: &str = "http://ip-api.com/batch";

#[derive(Clone, Serialize, Debug)]
pub struct GeoEndpoint {
    pub ip: String,
    pub lat: f64,
    pub lng: f64,
    pub city: String,
    pub country: String,
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
    pub protocol: String,
    pub dir: String,
    pub port: u16,
    pub service: Option<String>,
    pub started_at: f64,
}

#[derive(Clone, Serialize, Debug, Default)]
pub struct ProtoCounters {
    pub tcp: u32,
    pub udp: u32,
    pub icmp: u32,
    pub dns: u32,
    pub https: u32,
    pub http: u32,
    pub other: u32,
}

#[derive(Clone, Serialize, Debug)]
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
    pub net: NetMetrics,
    pub proto: ProtoCounters,
    pub flows: Vec<GeoFlow>,
}

struct ParsedConnection {
    proto: String,
    local_ip: String,
    remote_ip: String,
    remote_port: u16,
    state: String,
}

#[derive(Clone)]
struct GeoInfo {
    lat: f64,
    lng: f64,
    city: String,
    country: String,
}

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
        || ip.starts_with("fe80:")
        || ip.starts_with("fc00:")
        || ip.starts_with("fd")
        || ip == "*"
}

fn split_address(addr: &str) -> (String, u16) {
    if addr.starts_with('[') {
        if let Some(close) = addr.find(']') {
            let ip = addr[1..close].to_string();
            let port = addr
                .get(close + 2..)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            return (ip, port);
        }
    }
    if let Some(pos) = addr.rfind(':') {
        let ip = addr[..pos].to_string();
        let port = addr[pos + 1..].parse().unwrap_or(0);
        return (ip, port);
    }
    (addr.to_string(), 0)
}

fn get_service(port: u16) -> Option<&'static str> {
    match port {
        21 => Some("FTP"),
        22 => Some("SSH"),
        25 => Some("SMTP"),
        53 => Some("DNS"),
        80 => Some("HTTP"),
        110 => Some("POP3"),
        143 => Some("IMAP"),
        443 => Some("HTTPS"),
        465 => Some("SMTPS"),
        587 => Some("SMTP"),
        993 => Some("IMAPS"),
        995 => Some("POP3S"),
        1433 => Some("MSSQL"),
        3306 => Some("MySQL"),
        3389 => Some("RDP"),
        5432 => Some("Postgres"),
        5900 => Some("VNC"),
        6379 => Some("Redis"),
        8080 => Some("HTTP-Alt"),
        8443 => Some("HTTPS-Alt"),
        27017 => Some("MongoDB"),
        9090 => Some("Prometheus"),
        _ => None,
    }
}

fn parse_netstat() -> Vec<ParsedConnection> {
    let output = match StdCommand::new("netstat").args(["-no"]).output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[Abyss] netstat failed: {e}");
            return vec![];
        }
    };

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut connections = Vec::new();

    for line in raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }

        let proto = parts[0].to_uppercase();
        if proto != "TCP" && proto != "UDP" {
            continue;
        }

        let (local_ip, _local_port) = split_address(parts[1]);
        let (remote_ip, remote_port) = split_address(parts[2]);

        let state = if proto == "TCP" && parts.len() > 3 {
            parts[3].to_string()
        } else {
            "STATELESS".to_string()
        };

        if remote_ip == "*" || remote_ip == "0.0.0.0" || remote_ip.is_empty() {
            continue;
        }
        if is_private_ip(&remote_ip) {
            continue;
        }

        connections.push(ParsedConnection {
            proto: proto.to_lowercase(),
            local_ip,
            remote_ip,
            remote_port,
            state,
        });
    }

    connections
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
    client: &reqwest::Client,
    ips: &[String],
    cache: &mut HashMap<String, Option<GeoInfo>>,
) {
    let uncached: Vec<&String> = ips
        .iter()
        .filter(|ip| !cache.contains_key(*ip) && !is_private_ip(ip))
        .collect();

    if uncached.is_empty() {
        return;
    }

    let batch: Vec<&String> = uncached.into_iter().take(100).collect();
    let body: Vec<serde_json::Value> = batch
        .iter()
        .map(|ip| {
            serde_json::json!({
                "query": ip,
                "fields": "status,lat,lon,city,countryCode"
            })
        })
        .collect();

    match client.post(GEO_API).json(&body).send().await {
        Ok(resp) => {
            if let Ok(results) = resp.json::<Vec<GeoApiItem>>().await {
                for (i, r) in results.iter().enumerate() {
                    if i >= batch.len() {
                        break;
                    }
                    if r.status == "success" {
                        cache.insert(
                            batch[i].clone(),
                            Some(GeoInfo {
                                lat: r.lat.unwrap_or(0.0),
                                lng: r.lon.unwrap_or(0.0),
                                city: r.city.clone().unwrap_or_else(|| "Unknown".into()),
                                country: r
                                    .country_code
                                    .clone()
                                    .unwrap_or_else(|| "??".into()),
                            }),
                        );
                    } else {
                        cache.insert(batch[i].clone(), None);
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("[Abyss] GeoIP batch failed: {e}");
        }
    }
}

fn build_frame(
    connections: &[ParsedConnection],
    geo_cache: &HashMap<String, Option<GeoInfo>>,
    prev_keys: &mut HashSet<String>,
    local: &LocalGeo,
    elapsed: f64,
) -> TelemetryFrame {
    let mut rng = rand::thread_rng();

    let mut flow_map: HashMap<String, &ParsedConnection> = HashMap::new();
    for conn in connections {
        let key = format!("{}:{}:{}", conn.remote_ip, conn.remote_port, conn.proto);
        flow_map.entry(key).or_insert(conn);
    }

    let mut flows = Vec::new();
    let mut proto = ProtoCounters::default();
    let mut total_up: f64 = 0.0;
    let mut total_down: f64 = 0.0;

    for (key, conn) in &flow_map {
        let geo = match geo_cache.get(&conn.remote_ip) {
            Some(Some(g)) => g,
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
        let estimated_bps = if existed {
            base_bps * (0.5 + rng.gen::<f64>())
        } else {
            base_bps * 2.0
        };

        let dir = if conn.state == "ESTABLISHED" || conn.state == "STATELESS" {
            if rng.gen::<f64>() > 0.5 {
                "up"
            } else {
                "down"
            }
        } else {
            "bidi"
        };

        flows.push(GeoFlow {
            id: format!("live-{key}"),
            src: GeoEndpoint {
                ip: conn.local_ip.clone(),
                lat: local.lat,
                lng: local.lng,
                city: local.city.clone(),
                country: local.country.clone(),
            },
            dst: GeoEndpoint {
                ip: conn.remote_ip.clone(),
                lat: geo.lat,
                lng: geo.lng,
                city: geo.city.clone(),
                country: geo.country.clone(),
            },
            bps: estimated_bps,
            pps: (estimated_bps / 1000.0).max(1.0) as u32,
            rtt: 10.0 + rng.gen::<f64>() * 60.0,
            protocol: conn.proto.clone(),
            dir: dir.to_string(),
            port: conn.remote_port,
            service: get_service(conn.remote_port).map(|s| s.to_string()),
            started_at: elapsed,
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

    let total_bps = total_up + total_down;
    let total_pps: u32 = flows.iter().map(|f| f.pps).sum();
    let avg_rtt = if flows.is_empty() {
        0.0
    } else {
        flows.iter().map(|f| f.rtt).sum::<f64>() / flows.len() as f64
    };

    flows.truncate(50);

    TelemetryFrame {
        schema: SCHEMA_VERSION,
        t: elapsed,
        net: NetMetrics {
            bps: total_bps,
            pps: total_pps,
            active_flows: flows.len() as u32,
            latency_ms: avg_rtt,
            upload_bps: total_up,
            download_bps: total_down,
        },
        proto,
        flows,
    }
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

    let mut geo_cache: HashMap<String, Option<GeoInfo>> = HashMap::new();
    let mut prev_keys: HashSet<String> = HashSet::new();
    let start = Instant::now();
    let mut last_geo_lookup = Instant::now() - Duration::from_secs(10);

    println!("[Abyss] Monitor started — emitting telemetry-frame events @ 1 Hz");

    loop {
        let connections: Vec<ParsedConnection> =
            tokio::task::spawn_blocking(parse_netstat)
                .await
                .unwrap_or_default();

        if last_geo_lookup.elapsed() > Duration::from_secs(3) {
            let remote_ips: Vec<String> = connections
                .iter()
                .map(|c| c.remote_ip.clone())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();

            geolocate_batch(&client, &remote_ips, &mut geo_cache).await;
            last_geo_lookup = Instant::now();
        }

        let frame = build_frame(
            &connections,
            &geo_cache,
            &mut prev_keys,
            &local_geo,
            start.elapsed().as_secs_f64(),
        );

        let flow_count = frame.flows.len();
        let _ = app.emit("telemetry-frame", &frame);

        #[cfg(debug_assertions)]
        if flow_count > 0 {
            let mbps = (frame.net.bps * 8.0) / 1_000_000.0;
            println!(
                "[Abyss] {} flows | {:.1} Mbps | {} geo cached",
                flow_count, mbps, geo_cache.len()
            );
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
