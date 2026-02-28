use rusqlite::{params, Connection, Result as SqlResult};
use std::path::Path;

/// Current database schema version. Bump this when altering tables.
const DB_VERSION: u32 = 4;

/// Opens (or creates) the Abyss sessions database at `path` and runs any
/// pending migrations.  The connection is returned with WAL journal mode and
/// foreign-key enforcement enabled.
pub fn open_database(path: &Path) -> SqlResult<Connection> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(path)?;

    // Performance pragmas
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA cache_size = -8000;
         PRAGMA busy_timeout = 5000;",
    )?;

    migrate(&conn)?;
    Ok(conn)
}

/// Applies all schema migrations up to `DB_VERSION`.
fn migrate(conn: &Connection) -> SqlResult<()> {
    let version: u32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);

    if version < 1 {
        conn.execute_batch(SCHEMA_V1)?;
    }
    if version < 2 {
        conn.execute_batch(SCHEMA_V2)?;
    }
    if version < 3 {
        conn.execute_batch(SCHEMA_V3)?;
    }
    if version < 4 {
        conn.execute_batch(SCHEMA_V4)?;
    }

    conn.execute_batch(&format!("PRAGMA user_version = {DB_VERSION};"))?;
    Ok(())
}

/// V1 schema — initial tables.
const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    started_at      TEXT    NOT NULL,
    ended_at        TEXT,
    duration_secs   REAL,
    total_bytes_up  REAL    NOT NULL DEFAULT 0,
    total_bytes_down REAL   NOT NULL DEFAULT 0,
    total_flows     INTEGER NOT NULL DEFAULT 0,
    peak_bps        REAL    NOT NULL DEFAULT 0,
    peak_flows      INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms  REAL    NOT NULL DEFAULT 0,
    latency_samples INTEGER NOT NULL DEFAULT 0,
    local_city      TEXT    NOT NULL DEFAULT '',
    local_country   TEXT    NOT NULL DEFAULT '',
    notes           TEXT    NOT NULL DEFAULT '',
    tags            TEXT    NOT NULL DEFAULT '[]',
    schema_version  INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE IF NOT EXISTS frames (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t               REAL    NOT NULL,
    timestamp       TEXT    NOT NULL,
    bps             REAL    NOT NULL DEFAULT 0,
    pps             INTEGER NOT NULL DEFAULT 0,
    active_flows    INTEGER NOT NULL DEFAULT 0,
    latency_ms      REAL    NOT NULL DEFAULT 0,
    upload_bps      REAL    NOT NULL DEFAULT 0,
    download_bps    REAL    NOT NULL DEFAULT 0,
    proto_tcp       INTEGER NOT NULL DEFAULT 0,
    proto_udp       INTEGER NOT NULL DEFAULT 0,
    proto_icmp      INTEGER NOT NULL DEFAULT 0,
    proto_dns       INTEGER NOT NULL DEFAULT 0,
    proto_https     INTEGER NOT NULL DEFAULT 0,
    proto_http      INTEGER NOT NULL DEFAULT 0,
    proto_other     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_frames_session_t ON frames(session_id, t);

CREATE TABLE IF NOT EXISTS flow_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    frame_id        INTEGER REFERENCES frames(id) ON DELETE CASCADE,
    flow_id         TEXT    NOT NULL,
    src_ip          TEXT,
    src_city        TEXT,
    src_country     TEXT,
    dst_ip          TEXT    NOT NULL,
    dst_lat         REAL,
    dst_lng         REAL,
    dst_city        TEXT,
    dst_country     TEXT,
    dst_asn         TEXT,
    dst_org         TEXT,
    bps             REAL    NOT NULL DEFAULT 0,
    pps             INTEGER NOT NULL DEFAULT 0,
    rtt             REAL    NOT NULL DEFAULT 0,
    protocol        TEXT,
    dir             TEXT,
    port            INTEGER,
    service         TEXT,
    started_at      REAL,
    process         TEXT,
    pid             INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flowsnap_session ON flow_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_flowsnap_dst     ON flow_snapshots(dst_ip);
CREATE INDEX IF NOT EXISTS idx_flowsnap_process ON flow_snapshots(process);

CREATE TABLE IF NOT EXISTS process_usage (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    timestamp       TEXT    NOT NULL,
    process_name    TEXT    NOT NULL,
    bytes_up        REAL    NOT NULL DEFAULT 0,
    bytes_down      REAL    NOT NULL DEFAULT 0,
    flow_count      INTEGER NOT NULL DEFAULT 0,
    avg_rtt         REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_proc_session ON process_usage(session_id, process_name);

CREATE TABLE IF NOT EXISTS destinations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ip               TEXT    NOT NULL,
    city             TEXT,
    country          TEXT,
    asn              TEXT,
    org              TEXT,
    first_seen       REAL,
    last_seen        REAL,
    total_bytes      REAL    NOT NULL DEFAULT 0,
    connection_count INTEGER NOT NULL DEFAULT 1,
    primary_service  TEXT,
    primary_process  TEXT,
    UNIQUE(session_id, ip)
);

CREATE INDEX IF NOT EXISTS idx_dest_session ON destinations(session_id);
CREATE INDEX IF NOT EXISTS idx_dest_country ON destinations(session_id, country);
";

/// V2 schema — add local coordinates to sessions for playback map replay.
const SCHEMA_V2: &str = "
ALTER TABLE sessions ADD COLUMN local_lat REAL NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN local_lng REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_flowsnap_frame ON flow_snapshots(frame_id);
";

/// V3 schema — baseline profiles for anomaly detection + session search index.
const SCHEMA_V3: &str = "
CREATE TABLE IF NOT EXISTS baseline_profile (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    hour_of_day     INTEGER NOT NULL,
    day_of_week     INTEGER NOT NULL,
    avg_bps         REAL    NOT NULL DEFAULT 0,
    stddev_bps      REAL    NOT NULL DEFAULT 0,
    avg_flows       REAL    NOT NULL DEFAULT 0,
    stddev_flows    REAL    NOT NULL DEFAULT 0,
    avg_latency_ms  REAL    NOT NULL DEFAULT 0,
    stddev_latency  REAL    NOT NULL DEFAULT 0,
    common_processes TEXT   NOT NULL DEFAULT '[]',
    common_countries TEXT   NOT NULL DEFAULT '[]',
    sample_count    INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(hour_of_day, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
CREATE INDEX IF NOT EXISTS idx_sessions_tags ON sessions(tags);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
";

/// V4 schema — crash_recovered flag for distinguishing cleanly-ended from
/// crash-recovered sessions.
const SCHEMA_V4: &str = "
ALTER TABLE sessions ADD COLUMN crash_recovered INTEGER NOT NULL DEFAULT 0;
";

// ─── Query helpers ──────────────────────────────────────────────────────────

/// Insert a new session row.
pub fn insert_session(
    conn: &Connection,
    id: &str,
    name: &str,
    started_at: &str,
    local_city: &str,
    local_country: &str,
    local_lat: f64,
    local_lng: f64,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO sessions (id, name, started_at, local_city, local_country, local_lat, local_lng)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, name, started_at, local_city, local_country, local_lat, local_lng],
    )?;
    Ok(())
}

/// Finalize a session: set ended_at and compute duration.
pub fn finalize_session(conn: &Connection, id: &str, ended_at: &str) -> SqlResult<()> {
    conn.execute(
        "UPDATE sessions
         SET ended_at = ?1,
             duration_secs = (julianday(?1) - julianday(started_at)) * 86400.0
         WHERE id = ?2",
        params![ended_at, id],
    )?;
    Ok(())
}

/// Insert a telemetry frame row.  Returns the new row id.
pub fn insert_frame(
    conn: &Connection,
    session_id: &str,
    t: f64,
    timestamp: &str,
    bps: f64,
    pps: u32,
    active_flows: u32,
    latency_ms: f64,
    upload_bps: f64,
    download_bps: f64,
    proto_tcp: u32,
    proto_udp: u32,
    proto_icmp: u32,
    proto_dns: u32,
    proto_https: u32,
    proto_http: u32,
    proto_other: u32,
) -> SqlResult<i64> {
    conn.execute(
        "INSERT INTO frames
         (session_id,t,timestamp,bps,pps,active_flows,latency_ms,
          upload_bps,download_bps,
          proto_tcp,proto_udp,proto_icmp,proto_dns,proto_https,proto_http,proto_other)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![
            session_id,
            t,
            timestamp,
            bps,
            pps,
            active_flows,
            latency_ms,
            upload_bps,
            download_bps,
            proto_tcp,
            proto_udp,
            proto_icmp,
            proto_dns,
            proto_https,
            proto_http,
            proto_other,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Insert a flow snapshot row.
pub fn insert_flow_snapshot(
    conn: &Connection,
    session_id: &str,
    frame_id: i64,
    flow_id: &str,
    src_ip: &str,
    src_city: &str,
    src_country: &str,
    dst_ip: &str,
    dst_lat: f64,
    dst_lng: f64,
    dst_city: &str,
    dst_country: &str,
    dst_asn: Option<&str>,
    dst_org: Option<&str>,
    bps: f64,
    pps: u32,
    rtt: f64,
    protocol: &str,
    dir: &str,
    port: u16,
    service: Option<&str>,
    started_at: f64,
    process: Option<&str>,
    pid: Option<u32>,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO flow_snapshots
         (session_id,frame_id,flow_id,src_ip,src_city,src_country,
          dst_ip,dst_lat,dst_lng,dst_city,dst_country,dst_asn,dst_org,
          bps,pps,rtt,protocol,dir,port,service,started_at,process,pid)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
                 ?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
        params![
            session_id,
            frame_id,
            flow_id,
            src_ip,
            src_city,
            src_country,
            dst_ip,
            dst_lat,
            dst_lng,
            dst_city,
            dst_country,
            dst_asn,
            dst_org,
            bps,
            pps,
            rtt,
            protocol,
            dir,
            port,
            service,
            started_at,
            process,
            pid,
        ],
    )?;
    Ok(())
}

/// Update running totals on the session row.
pub fn update_session_totals(
    conn: &Connection,
    id: &str,
    bytes_up_delta: f64,
    bytes_down_delta: f64,
    current_bps: f64,
    current_flows: u32,
    latency_ms: f64,
    new_unique_flows: u32,
) -> SqlResult<()> {
    conn.execute(
        "UPDATE sessions SET
            total_bytes_up   = total_bytes_up   + ?1,
            total_bytes_down = total_bytes_down + ?2,
            peak_bps         = MAX(peak_bps, ?3),
            peak_flows       = MAX(peak_flows, ?4),
            avg_latency_ms   = CASE
                WHEN latency_samples = 0 THEN ?5
                ELSE (avg_latency_ms * latency_samples + ?5) / (latency_samples + 1)
            END,
            latency_samples  = latency_samples + 1,
            total_flows      = total_flows + ?6
         WHERE id = ?7",
        params![
            bytes_up_delta,
            bytes_down_delta,
            current_bps,
            current_flows,
            latency_ms,
            new_unique_flows,
            id,
        ],
    )?;
    Ok(())
}

/// Upsert a destination row for a session.
pub fn upsert_destination(
    conn: &Connection,
    session_id: &str,
    ip: &str,
    city: &str,
    country: &str,
    asn: Option<&str>,
    org: Option<&str>,
    t: f64,
    bytes: f64,
    service: Option<&str>,
    process: Option<&str>,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO destinations
            (session_id, ip, city, country, asn, org, first_seen, last_seen,
             total_bytes, connection_count, primary_service, primary_process)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?8,1,?9,?10)
         ON CONFLICT(session_id, ip) DO UPDATE SET
            last_seen        = MAX(last_seen, excluded.last_seen),
            total_bytes      = total_bytes + excluded.total_bytes,
            connection_count = connection_count + 1,
            primary_service  = COALESCE(excluded.primary_service, primary_service),
            primary_process  = COALESCE(excluded.primary_process, primary_process)",
        params![session_id, ip, city, country, asn, org, t, bytes, service, process],
    )?;
    Ok(())
}

/// Insert per-process usage snapshot.
pub fn insert_process_usage(
    conn: &Connection,
    session_id: &str,
    timestamp: &str,
    process_name: &str,
    bytes_up: f64,
    bytes_down: f64,
    flow_count: u32,
    avg_rtt: f64,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO process_usage
         (session_id, timestamp, process_name, bytes_up, bytes_down, flow_count, avg_rtt)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![session_id, timestamp, process_name, bytes_up, bytes_down, flow_count, avg_rtt],
    )?;
    Ok(())
}

/// Recover crashed sessions (those with NULL ended_at) by setting ended_at to
/// the latest frame timestamp, or the session start time if no frames exist.
pub fn recover_crashed_sessions(conn: &Connection) -> SqlResult<u32> {
    let mut count = 0u32;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.started_at,
                (SELECT MAX(timestamp) FROM frames f WHERE f.session_id = s.id)
         FROM sessions s
         WHERE s.ended_at IS NULL",
    )?;
    let rows: Vec<(String, String, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .filter_map(|r| r.ok())
        .collect();

    for (id, started_at, last_frame_ts) in rows {
        let ended = last_frame_ts.unwrap_or(started_at);
        finalize_session(conn, &id, &ended)?;
        // Mark as crash-recovered so the UI can show ⚠ status
        conn.execute(
            "UPDATE sessions SET crash_recovered = 1 WHERE id = ?1",
            params![id],
        )?;
        count += 1;
    }
    Ok(count)
}

// ─── Read queries used by Tauri commands ────────────────────────────────────

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_secs: Option<f64>,
    pub total_bytes_up: f64,
    pub total_bytes_down: f64,
    pub total_flows: i64,
    pub peak_bps: f64,
    pub peak_flows: i64,
    pub avg_latency_ms: f64,
    pub local_city: String,
    pub local_country: String,
    pub local_lat: f64,
    pub local_lng: f64,
    pub notes: String,
    pub tags: String,
    pub status: String,
}

pub fn list_sessions(
    conn: &Connection,
    limit: u32,
    offset: u32,
) -> SqlResult<Vec<SessionInfo>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, started_at, ended_at, duration_secs,
                total_bytes_up, total_bytes_down, total_flows,
                peak_bps, peak_flows, avg_latency_ms,
                local_city, local_country, local_lat, local_lng, notes, tags,
                crash_recovered
         FROM sessions
         ORDER BY started_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt
        .query_map(params![limit, offset], |row| {
            let ended_at: Option<String> = row.get(3)?;
            let crash_recovered: bool = row.get::<_, i32>(17).unwrap_or(0) != 0;
            let status = if ended_at.is_none() {
                "recording".to_string()
            } else if crash_recovered {
                "crashed".to_string()
            } else {
                "complete".to_string()
            };
            Ok(SessionInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                started_at: row.get(2)?,
                ended_at,
                duration_secs: row.get(4)?,
                total_bytes_up: row.get(5)?,
                total_bytes_down: row.get(6)?,
                total_flows: row.get(7)?,
                peak_bps: row.get(8)?,
                peak_flows: row.get(9)?,
                avg_latency_ms: row.get(10)?,
                local_city: row.get(11)?,
                local_country: row.get(12)?,
                local_lat: row.get(13)?,
                local_lng: row.get(14)?,
                notes: row.get(15)?,
                tags: row.get(16)?,
                status,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

pub fn get_session(conn: &Connection, id: &str) -> SqlResult<Option<SessionInfo>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, started_at, ended_at, duration_secs,
                total_bytes_up, total_bytes_down, total_flows,
                peak_bps, peak_flows, avg_latency_ms,
                local_city, local_country, local_lat, local_lng, notes, tags,
                crash_recovered
         FROM sessions WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        let ended_at: Option<String> = row.get(3)?;
        let crash_recovered: bool = row.get::<_, i32>(17).unwrap_or(0) != 0;
        let status = if ended_at.is_none() {
            "recording".to_string()
        } else if crash_recovered {
            "crashed".to_string()
        } else {
            "complete".to_string()
        };
        Ok(SessionInfo {
            id: row.get(0)?,
            name: row.get(1)?,
            started_at: row.get(2)?,
            ended_at,
            duration_secs: row.get(4)?,
            total_bytes_up: row.get(5)?,
            total_bytes_down: row.get(6)?,
            total_flows: row.get(7)?,
            peak_bps: row.get(8)?,
            peak_flows: row.get(9)?,
            avg_latency_ms: row.get(10)?,
            local_city: row.get(11)?,
            local_country: row.get(12)?,
            local_lat: row.get(13)?,
            local_lng: row.get(14)?,
            notes: row.get(15)?,
            tags: row.get(16)?,
            status,
        })
    })?;
    rows.next().transpose()
}

pub fn delete_session(conn: &Connection, id: &str) -> SqlResult<bool> {
    let affected = conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    Ok(affected > 0)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FrameRecord {
    pub t: f64,
    pub timestamp: String,
    pub bps: f64,
    pub upload_bps: f64,
    pub download_bps: f64,
    pub active_flows: i64,
    pub latency_ms: f64,
    pub pps: i64,
}

pub fn get_session_frames(
    conn: &Connection,
    session_id: &str,
    start_t: Option<f64>,
    end_t: Option<f64>,
    max_points: Option<u32>,
) -> SqlResult<Vec<FrameRecord>> {
    // Build the query dynamically based on optional time range
    let base = "SELECT t, timestamp, bps, upload_bps, download_bps,
                       active_flows, latency_ms, pps
                FROM frames WHERE session_id = ?1";
    let mut sql = base.to_string();
    let mut param_idx = 2u32;

    if start_t.is_some() {
        sql.push_str(&format!(" AND t >= ?{param_idx}"));
        param_idx += 1;
    }
    if end_t.is_some() {
        sql.push_str(&format!(" AND t <= ?{param_idx}"));
    }
    sql.push_str(" ORDER BY t ASC");

    // Collect results and optionally downsample
    let mut stmt = conn.prepare(&sql)?;

    // Build dynamic params
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params_vec.push(Box::new(session_id.to_string()));
    if let Some(s) = start_t {
        params_vec.push(Box::new(s));
    }
    if let Some(e) = end_t {
        params_vec.push(Box::new(e));
    }
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let all_rows: Vec<FrameRecord> = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(FrameRecord {
                t: row.get(0)?,
                timestamp: row.get(1)?,
                bps: row.get(2)?,
                upload_bps: row.get(3)?,
                download_bps: row.get(4)?,
                active_flows: row.get(5)?,
                latency_ms: row.get(6)?,
                pps: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Downsample if needed (LTTB-like: just take every Nth point for simplicity)
    if let Some(max) = max_points {
        let max = max as usize;
        if all_rows.len() <= max {
            return Ok(all_rows);
        }
        let step = all_rows.len() as f64 / max as f64;
        let mut result = Vec::with_capacity(max);
        for i in 0..max {
            let idx = (i as f64 * step) as usize;
            if idx < all_rows.len() {
                result.push(all_rows[idx].clone());
            }
        }
        // Always include last point
        if let Some(last) = all_rows.last() {
            if result.last().map(|r| r.t) != Some(last.t) {
                result.push(last.clone());
            }
        }
        return Ok(result);
    }

    Ok(all_rows)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FlowSnapshotRecord {
    pub flow_id: String,
    pub src_ip: Option<String>,
    pub src_city: Option<String>,
    pub src_country: Option<String>,
    pub dst_ip: String,
    pub dst_lat: Option<f64>,
    pub dst_lng: Option<f64>,
    pub dst_city: Option<String>,
    pub dst_country: Option<String>,
    pub dst_org: Option<String>,
    pub bps: f64,
    pub pps: i64,
    pub rtt: f64,
    pub protocol: Option<String>,
    pub dir: Option<String>,
    pub port: Option<i64>,
    pub service: Option<String>,
    pub process: Option<String>,
    pub pid: Option<i64>,
}

pub fn get_session_flows(
    conn: &Connection,
    session_id: &str,
    process_filter: Option<&str>,
    country_filter: Option<&str>,
    limit: u32,
) -> SqlResult<Vec<FlowSnapshotRecord>> {
    let mut sql = String::from(
        "SELECT flow_id, src_ip, src_city, src_country,
                dst_ip, dst_lat, dst_lng, dst_city, dst_country, dst_org,
                bps, pps, rtt, protocol, dir, port, service, process, pid
         FROM flow_snapshots WHERE session_id = ?1",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params_vec.push(Box::new(session_id.to_string()));

    if let Some(proc) = process_filter {
        params_vec.push(Box::new(proc.to_string()));
        sql.push_str(&format!(" AND process = ?{}", params_vec.len()));
    }
    if let Some(country) = country_filter {
        params_vec.push(Box::new(country.to_string()));
        sql.push_str(&format!(" AND dst_country = ?{}", params_vec.len()));
    }
    sql.push_str(" ORDER BY bps DESC");
    params_vec.push(Box::new(limit));
    sql.push_str(&format!(" LIMIT ?{}", params_vec.len()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(FlowSnapshotRecord {
                flow_id: row.get(0)?,
                src_ip: row.get(1)?,
                src_city: row.get(2)?,
                src_country: row.get(3)?,
                dst_ip: row.get(4)?,
                dst_lat: row.get(5)?,
                dst_lng: row.get(6)?,
                dst_city: row.get(7)?,
                dst_country: row.get(8)?,
                dst_org: row.get(9)?,
                bps: row.get(10)?,
                pps: row.get(11)?,
                rtt: row.get(12)?,
                protocol: row.get(13)?,
                dir: row.get(14)?,
                port: row.get(15)?,
                service: row.get(16)?,
                process: row.get(17)?,
                pid: row.get(18)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DestinationRecord {
    pub ip: String,
    pub city: Option<String>,
    pub country: Option<String>,
    pub asn: Option<String>,
    pub org: Option<String>,
    pub first_seen: Option<f64>,
    pub last_seen: Option<f64>,
    pub total_bytes: f64,
    pub connection_count: i64,
    pub primary_service: Option<String>,
    pub primary_process: Option<String>,
}

pub fn get_session_destinations(
    conn: &Connection,
    session_id: &str,
    sort_by: &str,
    limit: u32,
) -> SqlResult<Vec<DestinationRecord>> {
    let order = match sort_by {
        "connections" => "connection_count DESC",
        "first_seen" => "first_seen ASC",
        _ => "total_bytes DESC", // default "bytes"
    };
    let sql = format!(
        "SELECT ip, city, country, asn, org, first_seen, last_seen,
                total_bytes, connection_count, primary_service, primary_process
         FROM destinations WHERE session_id = ?1
         ORDER BY {order}
         LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![session_id, limit], |row| {
            Ok(DestinationRecord {
                ip: row.get(0)?,
                city: row.get(1)?,
                country: row.get(2)?,
                asn: row.get(3)?,
                org: row.get(4)?,
                first_seen: row.get(5)?,
                last_seen: row.get(6)?,
                total_bytes: row.get(7)?,
                connection_count: row.get(8)?,
                primary_service: row.get(9)?,
                primary_process: row.get(10)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsageRecord {
    pub timestamp: String,
    pub process_name: String,
    pub bytes_up: f64,
    pub bytes_down: f64,
    pub flow_count: i64,
    pub avg_rtt: f64,
}

pub fn get_process_usage(
    conn: &Connection,
    session_id: &str,
    process_name: Option<&str>,
    limit: u32,
) -> SqlResult<Vec<ProcessUsageRecord>> {
    let mut sql = String::from(
        "SELECT timestamp, process_name, bytes_up, bytes_down, flow_count, avg_rtt
         FROM process_usage WHERE session_id = ?1",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params_vec.push(Box::new(session_id.to_string()));

    if let Some(name) = process_name {
        params_vec.push(Box::new(name.to_string()));
        sql.push_str(&format!(" AND process_name = ?{}", params_vec.len()));
    }
    sql.push_str(" ORDER BY timestamp ASC");
    params_vec.push(Box::new(limit));
    sql.push_str(&format!(" LIMIT ?{}", params_vec.len()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(ProcessUsageRecord {
                timestamp: row.get(0)?,
                process_name: row.get(1)?,
                bytes_up: row.get(2)?,
                bytes_down: row.get(3)?,
                flow_count: row.get(4)?,
                avg_rtt: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GlobalStats {
    pub total_sessions: i64,
    pub total_recording_hours: f64,
    pub total_bytes_transferred: f64,
    pub database_size_mb: f64,
    pub oldest_session: Option<String>,
    pub newest_session: Option<String>,
}

pub fn get_global_stats(conn: &Connection, db_path: &Path) -> SqlResult<GlobalStats> {
    let total_sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap_or(0);
    let total_hours: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(duration_secs), 0) / 3600.0 FROM sessions WHERE duration_secs IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);
    let total_bytes: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_bytes_up + total_bytes_down), 0) FROM sessions",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0.0);
    let oldest: Option<String> = conn
        .query_row(
            "SELECT started_at FROM sessions ORDER BY started_at ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    let newest: Option<String> = conn
        .query_row(
            "SELECT started_at FROM sessions ORDER BY started_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();

    let db_size = std::fs::metadata(db_path)
        .map(|m| m.len() as f64 / (1024.0 * 1024.0))
        .unwrap_or(0.0);

    Ok(GlobalStats {
        total_sessions,
        total_recording_hours: total_hours,
        total_bytes_transferred: total_bytes,
        database_size_mb: db_size,
        oldest_session: oldest,
        newest_session: newest,
    })
}

/// Update session name, notes, or tags.
pub fn update_session_meta(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    notes: Option<&str>,
    tags: Option<&str>,
) -> SqlResult<bool> {
    let mut parts = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(n) = name {
        params_vec.push(Box::new(n.to_string()));
        parts.push(format!("name = ?{}", params_vec.len()));
    }
    if let Some(n) = notes {
        params_vec.push(Box::new(n.to_string()));
        parts.push(format!("notes = ?{}", params_vec.len()));
    }
    if let Some(t) = tags {
        params_vec.push(Box::new(t.to_string()));
        parts.push(format!("tags = ?{}", params_vec.len()));
    }

    if parts.is_empty() {
        return Ok(false);
    }

    params_vec.push(Box::new(id.to_string()));
    let sql = format!(
        "UPDATE sessions SET {} WHERE id = ?{}",
        parts.join(", "),
        params_vec.len()
    );

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let affected = conn.execute(&sql, param_refs.as_slice())?;
    Ok(affected > 0)
}

/// Session count for storage management display.
#[allow(dead_code)]
pub fn session_count(conn: &Connection) -> SqlResult<i64> {
    conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
}

/// Delete sessions older than `days` days.
pub fn cleanup_old_sessions(conn: &Connection, days: u32) -> SqlResult<u32> {
    let affected = conn.execute(
        "DELETE FROM sessions WHERE ended_at IS NOT NULL
         AND julianday('now') - julianday(started_at) > ?1",
        params![days],
    )?;
    // Reclaim space
    conn.execute_batch("PRAGMA incremental_vacuum;")?;
    Ok(affected as u32)
}

/// Delete oldest sessions to keep at most `max_count` sessions.
/// Returns how many sessions were deleted.
pub fn cleanup_excess_sessions(conn: &Connection, max_count: u32) -> SqlResult<u32> {
    if max_count == 0 {
        return Ok(0);
    }
    let affected = conn.execute(
        "DELETE FROM sessions WHERE id IN (
            SELECT id FROM sessions
            WHERE ended_at IS NOT NULL
            ORDER BY started_at DESC
            LIMIT -1 OFFSET ?1
        )",
        params![max_count],
    )?;
    if affected > 0 {
        conn.execute_batch("PRAGMA incremental_vacuum;")?;
    }
    Ok(affected as u32)
}

/// Delete ALL completed sessions. Returns count deleted.
pub fn delete_all_sessions(conn: &Connection) -> SqlResult<u32> {
    let affected = conn.execute(
        "DELETE FROM sessions WHERE ended_at IS NOT NULL",
        [],
    )?;
    // Use incremental_vacuum instead of full VACUUM to avoid
    // locking the DB for a long time in WAL mode.
    if affected > 0 {
        conn.execute_batch("PRAGMA incremental_vacuum;")?;
    }
    Ok(affected as u32)
}

/// Get Rust-side database file path string (for "Open data folder").
pub fn get_database_path(db_path: &Path) -> String {
    db_path.to_string_lossy().to_string()
}

// ─── Analytics (Tier 4) ─────────────────────────────────────────────────────

/// Daily usage record — aggregated bytes per calendar day.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String, // "YYYY-MM-DD"
    pub bytes_up: f64,
    pub bytes_down: f64,
    pub session_count: i64,
    pub total_duration_secs: f64,
}

/// Query daily data usage, aggregated from session totals.
/// `range_days` limits to last N days (0 = all time).
pub fn get_daily_usage(conn: &Connection, range_days: u32) -> SqlResult<Vec<DailyUsage>> {
    let sql = if range_days > 0 {
        "SELECT DATE(started_at) AS day,
                COALESCE(SUM(total_bytes_up), 0),
                COALESCE(SUM(total_bytes_down), 0),
                COUNT(*),
                COALESCE(SUM(duration_secs), 0)
         FROM sessions
         WHERE julianday('now') - julianday(started_at) <= ?1
         GROUP BY day
         ORDER BY day ASC"
    } else {
        "SELECT DATE(started_at) AS day,
                COALESCE(SUM(total_bytes_up), 0),
                COALESCE(SUM(total_bytes_down), 0),
                COUNT(*),
                COALESCE(SUM(duration_secs), 0)
         FROM sessions
         GROUP BY day
         ORDER BY day ASC"
    };

    let mut stmt = conn.prepare(sql)?;
    let rows: Vec<DailyUsage> = if range_days > 0 {
        stmt.query_map(params![range_days], |row| {
            Ok(DailyUsage {
                date: row.get(0)?,
                bytes_up: row.get::<_, f64>(1).unwrap_or(0.0),
                bytes_down: row.get::<_, f64>(2).unwrap_or(0.0),
                session_count: row.get::<_, i64>(3).unwrap_or(0),
                total_duration_secs: row.get::<_, f64>(4).unwrap_or(0.0),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map([], |row| {
            Ok(DailyUsage {
                date: row.get(0)?,
                bytes_up: row.get::<_, f64>(1).unwrap_or(0.0),
                bytes_down: row.get::<_, f64>(2).unwrap_or(0.0),
                session_count: row.get::<_, i64>(3).unwrap_or(0),
                total_duration_secs: row.get::<_, f64>(4).unwrap_or(0.0),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

/// Top destination record — most contacted IPs across all sessions.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TopDestination {
    pub ip: String,
    pub city: String,
    pub country: String,
    pub org: String,
    pub total_bytes: f64,
    pub connection_count: i64,
    pub primary_service: String,
    pub primary_process: String,
}

/// Get most contacted destinations across all/recent sessions.
pub fn get_top_destinations(conn: &Connection, range_days: u32, limit: u32) -> SqlResult<Vec<TopDestination>> {
    let sql = if range_days > 0 {
        "SELECT d.ip,
                COALESCE(d.city, ''), COALESCE(d.country, ''),
                COALESCE(d.org, ''),
                COALESCE(SUM(d.total_bytes), 0),
                COALESCE(SUM(d.connection_count), 0),
                COALESCE(d.primary_service, ''),
                COALESCE(d.primary_process, '')
         FROM destinations d
         JOIN sessions s ON d.session_id = s.id
         WHERE julianday('now') - julianday(s.started_at) <= ?1
         GROUP BY d.ip
         ORDER BY SUM(d.total_bytes) DESC
         LIMIT ?2"
    } else {
        "SELECT d.ip,
                COALESCE(d.city, ''), COALESCE(d.country, ''),
                COALESCE(d.org, ''),
                COALESCE(SUM(d.total_bytes), 0),
                COALESCE(SUM(d.connection_count), 0),
                COALESCE(d.primary_service, ''),
                COALESCE(d.primary_process, '')
         FROM destinations d
         GROUP BY d.ip
         ORDER BY SUM(d.total_bytes) DESC
         LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql)?;
    let rows: Vec<TopDestination> = if range_days > 0 {
        stmt.query_map(params![range_days, limit], |row| {
            Ok(TopDestination {
                ip: row.get(0)?,
                city: row.get(1)?,
                country: row.get(2)?,
                org: row.get(3)?,
                total_bytes: row.get::<_, f64>(4).unwrap_or(0.0),
                connection_count: row.get::<_, i64>(5).unwrap_or(0),
                primary_service: row.get::<_, String>(6).unwrap_or_default(),
                primary_process: row.get::<_, String>(7).unwrap_or_default(),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map(params![limit], |row| {
            Ok(TopDestination {
                ip: row.get(0)?,
                city: row.get(1)?,
                country: row.get(2)?,
                org: row.get(3)?,
                total_bytes: row.get::<_, f64>(4).unwrap_or(0.0),
                connection_count: row.get::<_, i64>(5).unwrap_or(0),
                primary_service: row.get::<_, String>(6).unwrap_or_default(),
                primary_process: row.get::<_, String>(7).unwrap_or_default(),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

/// Top app/process record — processes ranked by total data volume.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TopApp {
    pub process_name: String,
    pub total_bytes_up: f64,
    pub total_bytes_down: f64,
    pub total_flows: i64,
    pub avg_rtt: f64,
}

/// Get most data-hungry processes across all/recent sessions.
pub fn get_top_apps(conn: &Connection, range_days: u32, limit: u32) -> SqlResult<Vec<TopApp>> {
    let sql = if range_days > 0 {
        "SELECT p.process_name,
                COALESCE(SUM(p.bytes_up), 0),
                COALESCE(SUM(p.bytes_down), 0),
                COALESCE(SUM(p.flow_count), 0),
                AVG(CASE WHEN p.avg_rtt > 0 THEN p.avg_rtt ELSE NULL END)
         FROM process_usage p
         JOIN sessions s ON p.session_id = s.id
         WHERE julianday('now') - julianday(s.started_at) <= ?1
         GROUP BY p.process_name
         ORDER BY SUM(p.bytes_up + p.bytes_down) DESC
         LIMIT ?2"
    } else {
        "SELECT p.process_name,
                COALESCE(SUM(p.bytes_up), 0),
                COALESCE(SUM(p.bytes_down), 0),
                COALESCE(SUM(p.flow_count), 0),
                AVG(CASE WHEN p.avg_rtt > 0 THEN p.avg_rtt ELSE NULL END)
         FROM process_usage p
         GROUP BY p.process_name
         ORDER BY SUM(p.bytes_up + p.bytes_down) DESC
         LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql)?;
    let rows: Vec<TopApp> = if range_days > 0 {
        stmt.query_map(params![range_days, limit], |row| {
            Ok(TopApp {
                process_name: row.get(0)?,
                total_bytes_up: row.get::<_, f64>(1).unwrap_or(0.0),
                total_bytes_down: row.get::<_, f64>(2).unwrap_or(0.0),
                total_flows: row.get::<_, i64>(3).unwrap_or(0),
                avg_rtt: row.get::<_, f64>(4).unwrap_or(0.0),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    } else {
        stmt.query_map(params![limit], |row| {
            Ok(TopApp {
                process_name: row.get(0)?,
                total_bytes_up: row.get::<_, f64>(1).unwrap_or(0.0),
                total_bytes_down: row.get::<_, f64>(2).unwrap_or(0.0),
                total_flows: row.get::<_, i64>(3).unwrap_or(0),
                avg_rtt: row.get::<_, f64>(4).unwrap_or(0.0),
            })
        })?
        .filter_map(|r| r.ok())
        .collect()
    };

    Ok(rows)
}

// ─── Post-session insights ──────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInsights {
    pub total_data_human: String,
    pub busiest_minute: String,
    pub most_active_process: String,
    pub unique_countries: i64,
    pub unique_destinations: i64,
    pub high_latency_destinations: Vec<String>,
    pub top_services: Vec<String>,
    pub unusual_ports: Vec<i64>,
    pub longest_connection: Option<LongestConnectionInfo>,
}

/// Info about the single longest-lived flow/connection in a session.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LongestConnectionInfo {
    pub dst_ip: String,
    pub service: String,
    pub duration_secs: f64,
}

/// Compute post-session insights from the stored data for a given session.
pub fn compute_session_insights(conn: &Connection, session_id: &str) -> SqlResult<SessionInsights> {
    // Total data
    let (bytes_up, bytes_down): (f64, f64) = conn.query_row(
        "SELECT COALESCE(total_bytes_up, 0), COALESCE(total_bytes_down, 0) FROM sessions WHERE id = ?1",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let total_bytes = bytes_up + bytes_down;
    let total_data_human = format_bytes_human(total_bytes);

    // Busiest minute — find the frame with highest bps
    let busiest_minute: String = conn
        .query_row(
            "SELECT COALESCE(timestamp, '') FROM frames WHERE session_id = ?1 ORDER BY bps DESC LIMIT 1",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap_or_default();

    // Most active process by total bytes
    let most_active_process: String = conn
        .query_row(
            "SELECT COALESCE(process_name, 'Unknown') FROM process_usage WHERE session_id = ?1
             GROUP BY process_name ORDER BY SUM(bytes_up + bytes_down) DESC LIMIT 1",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "Unknown".to_string());

    // Unique countries
    let unique_countries: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT country) FROM destinations WHERE session_id = ?1 AND country IS NOT NULL AND country != ''",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Unique destinations
    let unique_destinations: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT ip) FROM destinations WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // High latency destinations (avg RTT > 200ms from flow_snapshots)
    let mut stmt = conn.prepare(
        "SELECT DISTINCT fs.dst_ip FROM flow_snapshots fs
         JOIN frames f ON fs.frame_id = f.id
         WHERE f.session_id = ?1 AND fs.rtt > 200
         LIMIT 10"
    )?;
    let high_latency_destinations: Vec<String> = stmt
        .query_map(params![session_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    // Top services
    let mut stmt = conn.prepare(
        "SELECT COALESCE(fs.service, 'unknown') as svc FROM flow_snapshots fs
         JOIN frames f ON fs.frame_id = f.id
         WHERE f.session_id = ?1 AND fs.service IS NOT NULL AND fs.service != ''
         GROUP BY svc ORDER BY SUM(fs.bps) DESC LIMIT 5"
    )?;
    let top_services: Vec<String> = stmt
        .query_map(params![session_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    // Unusual ports (not in common set: 80, 443, 53, 22, 21, 25, 110, 143, 993, 995, 8080, 8443)
    let mut stmt = conn.prepare(
        "SELECT DISTINCT fs.port FROM flow_snapshots fs
         JOIN frames f ON fs.frame_id = f.id
         WHERE f.session_id = ?1 AND fs.port IS NOT NULL
           AND fs.port NOT IN (80, 443, 53, 22, 21, 25, 110, 143, 993, 995, 8080, 8443, 0)
         ORDER BY fs.port LIMIT 20"
    )?;
    let unusual_ports: Vec<i64> = stmt
        .query_map(params![session_id], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    // Longest connection — flow that spans the most frames (i.e., was alive longest)
    let longest_connection: Option<LongestConnectionInfo> = conn
        .query_row(
            "SELECT fs.dst_ip,
                    COALESCE(fs.service, ''),
                    (MAX(f.t) - MIN(f.t)) AS dur
             FROM flow_snapshots fs
             JOIN frames f ON fs.frame_id = f.id
             WHERE f.session_id = ?1 AND fs.flow_id IS NOT NULL
             GROUP BY fs.flow_id
             ORDER BY dur DESC
             LIMIT 1",
            params![session_id],
            |row| {
                Ok(LongestConnectionInfo {
                    dst_ip: row.get(0)?,
                    service: row.get(1)?,
                    duration_secs: row.get::<_, f64>(2).unwrap_or(0.0),
                })
            },
        )
        .ok();

    Ok(SessionInsights {
        total_data_human,
        busiest_minute,
        most_active_process,
        unique_countries,
        unique_destinations,
        high_latency_destinations,
        top_services,
        unusual_ports,
        longest_connection,
    })
}

fn format_bytes_human(bytes: f64) -> String {
    if !bytes.is_finite() || bytes < 0.0 {
        return "0 B".to_string();
    }
    if bytes >= 1e12 {
        format!("{:.1} TB", bytes / 1e12)
    } else if bytes >= 1e9 {
        format!("{:.1} GB", bytes / 1e9)
    } else if bytes >= 1e6 {
        format!("{:.1} MB", bytes / 1e6)
    } else if bytes >= 1e3 {
        format!("{:.1} KB", bytes / 1e3)
    } else {
        format!("{bytes:.0} B")
    }
}

// ─── Playback support ───────────────────────────────────────────────────────

/// A full frame record including proto counters (needed to reconstruct TelemetryFrame).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackFrameRecord {
    pub frame_id: i64,
    pub t: f64,
    pub bps: f64,
    pub upload_bps: f64,
    pub download_bps: f64,
    pub active_flows: i64,
    pub latency_ms: f64,
    pub pps: i64,
    pub proto_tcp: i64,
    pub proto_udp: i64,
    pub proto_icmp: i64,
    pub proto_dns: i64,
    pub proto_https: i64,
    pub proto_http: i64,
    pub proto_other: i64,
}

/// A flow snapshot with source lat/lng (for map rendering during playback).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackFlowRecord {
    pub frame_id: i64,
    pub flow_id: String,
    pub src_ip: String,
    pub src_city: String,
    pub src_country: String,
    pub dst_ip: String,
    pub dst_lat: f64,
    pub dst_lng: f64,
    pub dst_city: String,
    pub dst_country: String,
    pub dst_org: String,
    pub bps: f64,
    pub pps: i64,
    pub rtt: f64,
    pub protocol: String,
    pub dir: String,
    pub port: i64,
    pub service: String,
    pub started_at: f64,
    pub process: String,
    pub pid: i64,
}

/// Complete playback data bundle — one IPC call loads everything.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackData {
    pub session: SessionInfo,
    pub frames: Vec<PlaybackFrameRecord>,
    pub flows: Vec<PlaybackFlowRecord>,
}

/// Load all playback data for a session in a single query batch.
pub fn get_playback_data(conn: &Connection, session_id: &str) -> SqlResult<Option<PlaybackData>> {
    let session = match get_session(conn, session_id)? {
        Some(s) => s,
        None => return Ok(None),
    };

    // Load all frames with proto counters
    let mut frame_stmt = conn.prepare(
        "SELECT id, t, bps, upload_bps, download_bps, active_flows, latency_ms, pps,
                proto_tcp, proto_udp, proto_icmp, proto_dns, proto_https, proto_http, proto_other
         FROM frames
         WHERE session_id = ?1
         ORDER BY t ASC",
    )?;
    let frames: Vec<PlaybackFrameRecord> = frame_stmt
        .query_map(params![session_id], |row| {
            Ok(PlaybackFrameRecord {
                frame_id: row.get(0)?,
                t: row.get(1)?,
                bps: row.get(2)?,
                upload_bps: row.get(3)?,
                download_bps: row.get(4)?,
                active_flows: row.get(5)?,
                latency_ms: row.get(6)?,
                pps: row.get(7)?,
                proto_tcp: row.get(8)?,
                proto_udp: row.get(9)?,
                proto_icmp: row.get(10)?,
                proto_dns: row.get(11)?,
                proto_https: row.get(12)?,
                proto_http: row.get(13)?,
                proto_other: row.get(14)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Load all flow snapshots for this session (joined by frame_id)
    let mut flow_stmt = conn.prepare(
        "SELECT frame_id, flow_id,
                COALESCE(src_ip, ''), COALESCE(src_city, ''), COALESCE(src_country, ''),
                dst_ip, COALESCE(dst_lat, 0), COALESCE(dst_lng, 0),
                COALESCE(dst_city, ''), COALESCE(dst_country, ''), COALESCE(dst_org, ''),
                bps, pps, rtt,
                COALESCE(protocol, ''), COALESCE(dir, ''),
                COALESCE(port, 0), COALESCE(service, ''),
                COALESCE(started_at, 0),
                COALESCE(process, ''), COALESCE(pid, 0)
         FROM flow_snapshots
         WHERE session_id = ?1
         ORDER BY frame_id ASC, bps DESC",
    )?;
    let flows: Vec<PlaybackFlowRecord> = flow_stmt
        .query_map(params![session_id], |row| {
            Ok(PlaybackFlowRecord {
                frame_id: row.get(0)?,
                flow_id: row.get(1)?,
                src_ip: row.get(2)?,
                src_city: row.get(3)?,
                src_country: row.get(4)?,
                dst_ip: row.get(5)?,
                dst_lat: row.get(6)?,
                dst_lng: row.get(7)?,
                dst_city: row.get(8)?,
                dst_country: row.get(9)?,
                dst_org: row.get(10)?,
                bps: row.get(11)?,
                pps: row.get(12)?,
                rtt: row.get(13)?,
                protocol: row.get(14)?,
                dir: row.get(15)?,
                port: row.get(16)?,
                service: row.get(17)?,
                started_at: row.get(18)?,
                process: row.get(19)?,
                pid: row.get(20)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Some(PlaybackData {
        session,
        frames,
        flows,
    }))
}

// ─── Tier 6: Baseline, Anomaly Detection, Health Score, Tagging/Search ──────

/// A single hour-of-day × day-of-week baseline bucket.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BaselineEntry {
    pub hour_of_day: i32,
    pub day_of_week: i32,
    pub avg_bps: f64,
    pub stddev_bps: f64,
    pub avg_flows: f64,
    pub stddev_flows: f64,
    pub avg_latency_ms: f64,
    pub stddev_latency: f64,
    pub common_processes: Vec<String>,
    pub common_countries: Vec<String>,
    pub sample_count: i64,
}

/// Recompute the baseline_profile table from the last `range_days` of data.
/// Uses hour-of-day (0-23) × day-of-week (0=Sunday..6=Saturday) buckets.
/// Each bucket stores the mean & stddev of bps, flows, latency.
pub fn compute_baseline(conn: &Connection, range_days: u32) -> SqlResult<u32> {
    let range = if range_days == 0 { 90 } else { range_days };

    // Clear existing baselines
    conn.execute("DELETE FROM baseline_profile", [])?;

    // Aggregate frame-level data into hour×dow buckets
    let sql = "
        SELECT
            CAST(strftime('%H', f.timestamp) AS INTEGER) AS hour_of_day,
            CAST(strftime('%w', f.timestamp) AS INTEGER) AS day_of_week,
            AVG(f.bps)       AS avg_bps,
            -- population stddev via sqrt(avg(x²) - avg(x)²)
            CASE WHEN COUNT(*) > 1
                 THEN sqrt(MAX(0, AVG(f.bps * f.bps) - AVG(f.bps) * AVG(f.bps)))
                 ELSE 0 END AS stddev_bps,
            AVG(f.active_flows) AS avg_flows,
            CASE WHEN COUNT(*) > 1
                 THEN sqrt(MAX(0, AVG(CAST(f.active_flows AS REAL) * f.active_flows) - AVG(CAST(f.active_flows AS REAL)) * AVG(CAST(f.active_flows AS REAL))))
                 ELSE 0 END AS stddev_flows,
            AVG(f.latency_ms)   AS avg_latency,
            CASE WHEN COUNT(*) > 1
                 THEN sqrt(MAX(0, AVG(f.latency_ms * f.latency_ms) - AVG(f.latency_ms) * AVG(f.latency_ms)))
                 ELSE 0 END AS stddev_latency,
            COUNT(*) AS sample_count
        FROM frames f
        JOIN sessions s ON s.id = f.session_id
        WHERE julianday('now') - julianday(s.started_at) <= ?1
          AND s.ended_at IS NOT NULL
        GROUP BY hour_of_day, day_of_week
    ";

    let mut stmt = conn.prepare(sql)?;
    let buckets: Vec<(i32, i32, f64, f64, f64, f64, f64, f64, i64)> = stmt
        .query_map(params![range], |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, f64>(2).unwrap_or(0.0),
                row.get::<_, f64>(3).unwrap_or(0.0),
                row.get::<_, f64>(4).unwrap_or(0.0),
                row.get::<_, f64>(5).unwrap_or(0.0),
                row.get::<_, f64>(6).unwrap_or(0.0),
                row.get::<_, f64>(7).unwrap_or(0.0),
                row.get::<_, i64>(8).unwrap_or(0),
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // For each bucket, also find the top processes and countries
    let proc_sql = "
        SELECT fs.process, COUNT(*) AS cnt
        FROM flow_snapshots fs
        JOIN sessions s ON s.id = fs.session_id
        WHERE julianday('now') - julianday(s.started_at) <= ?1
          AND s.ended_at IS NOT NULL
          AND CAST(strftime('%H', s.started_at) AS INTEGER) = ?2
          AND CAST(strftime('%w', s.started_at) AS INTEGER) = ?3
          AND fs.process IS NOT NULL AND fs.process != ''
        GROUP BY fs.process
        ORDER BY cnt DESC
        LIMIT 10
    ";
    let country_sql = "
        SELECT fs.dst_country, COUNT(*) AS cnt
        FROM flow_snapshots fs
        JOIN sessions s ON s.id = fs.session_id
        WHERE julianday('now') - julianday(s.started_at) <= ?1
          AND s.ended_at IS NOT NULL
          AND CAST(strftime('%H', s.started_at) AS INTEGER) = ?2
          AND CAST(strftime('%w', s.started_at) AS INTEGER) = ?3
          AND fs.dst_country IS NOT NULL AND fs.dst_country != ''
        GROUP BY fs.dst_country
        ORDER BY cnt DESC
        LIMIT 10
    ";

    let mut insert_stmt = conn.prepare(
        "INSERT INTO baseline_profile
         (hour_of_day, day_of_week, avg_bps, stddev_bps, avg_flows, stddev_flows,
          avg_latency_ms, stddev_latency, common_processes, common_countries,
          sample_count, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, datetime('now'))"
    )?;

    for &(hour, dow, avg_b, std_b, avg_f, std_f, avg_l, std_l, cnt) in &buckets {
        let procs: Vec<String> = {
            let mut ps = conn.prepare(proc_sql)?;
            let rows = ps.query_map(params![range, hour, dow], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };
        let countries: Vec<String> = {
            let mut cs = conn.prepare(country_sql)?;
            let rows = cs.query_map(params![range, hour, dow], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        let procs_json = serde_json::to_string(&procs).unwrap_or_else(|_| "[]".to_string());
        let countries_json = serde_json::to_string(&countries).unwrap_or_else(|_| "[]".to_string());

        insert_stmt.execute(params![
            hour, dow, avg_b, std_b, avg_f, std_f, avg_l, std_l,
            procs_json, countries_json, cnt
        ])?;
    }

    Ok(buckets.len() as u32)
}

/// Retrieve the full baseline profile (all hour×dow buckets).
pub fn get_baseline_profile(conn: &Connection) -> SqlResult<Vec<BaselineEntry>> {
    let mut stmt = conn.prepare(
        "SELECT hour_of_day, day_of_week, avg_bps, stddev_bps, avg_flows,
                stddev_flows, avg_latency_ms, stddev_latency,
                common_processes, common_countries, sample_count
         FROM baseline_profile
         ORDER BY day_of_week, hour_of_day"
    )?;
    let rows = stmt
        .query_map([], |row| {
            let proc_str: String = row.get::<_, String>(8).unwrap_or_else(|_| "[]".to_string());
            let country_str: String = row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string());
            Ok(BaselineEntry {
                hour_of_day: row.get(0)?,
                day_of_week: row.get(1)?,
                avg_bps: row.get::<_, f64>(2).unwrap_or(0.0),
                stddev_bps: row.get::<_, f64>(3).unwrap_or(0.0),
                avg_flows: row.get::<_, f64>(4).unwrap_or(0.0),
                stddev_flows: row.get::<_, f64>(5).unwrap_or(0.0),
                avg_latency_ms: row.get::<_, f64>(6).unwrap_or(0.0),
                stddev_latency: row.get::<_, f64>(7).unwrap_or(0.0),
                common_processes: serde_json::from_str(&proc_str).unwrap_or_default(),
                common_countries: serde_json::from_str(&country_str).unwrap_or_default(),
                sample_count: row.get::<_, i64>(10).unwrap_or(0),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Get the baseline entry for a specific hour and day-of-week.
pub fn get_baseline_for_time(conn: &Connection, hour: i32, dow: i32) -> SqlResult<Option<BaselineEntry>> {
    let result = conn.query_row(
        "SELECT hour_of_day, day_of_week, avg_bps, stddev_bps, avg_flows,
                stddev_flows, avg_latency_ms, stddev_latency,
                common_processes, common_countries, sample_count
         FROM baseline_profile
         WHERE hour_of_day = ?1 AND day_of_week = ?2",
        params![hour, dow],
        |row| {
            let proc_str: String = row.get::<_, String>(8).unwrap_or_else(|_| "[]".to_string());
            let country_str: String = row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string());
            Ok(BaselineEntry {
                hour_of_day: row.get(0)?,
                day_of_week: row.get(1)?,
                avg_bps: row.get::<_, f64>(2).unwrap_or(0.0),
                stddev_bps: row.get::<_, f64>(3).unwrap_or(0.0),
                avg_flows: row.get::<_, f64>(4).unwrap_or(0.0),
                stddev_flows: row.get::<_, f64>(5).unwrap_or(0.0),
                avg_latency_ms: row.get::<_, f64>(6).unwrap_or(0.0),
                stddev_latency: row.get::<_, f64>(7).unwrap_or(0.0),
                common_processes: serde_json::from_str(&proc_str).unwrap_or_default(),
                common_countries: serde_json::from_str(&country_str).unwrap_or_default(),
                sample_count: row.get(10)?,
            })
        },
    );
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Anomaly types detected against the baseline.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Anomaly {
    pub anomaly_type: String,   // "THROUGHPUT_SPIKE", "LATENCY_SPIKE", etc.
    pub severity: String,       // "low", "medium", "high"
    pub message: String,
    pub current_value: f64,
    pub baseline_avg: f64,
    pub baseline_stddev: f64,
    pub deviation_sigmas: f64,  // how many σ away
}

/// Detect anomalies for a specific session by comparing its metrics to the baseline.
pub fn detect_anomalies(conn: &Connection, session_id: &str) -> SqlResult<Vec<Anomaly>> {
    let mut anomalies = Vec::new();

    // Get session's average metrics
    let session_stats = conn.query_row(
        "SELECT AVG(f.bps), AVG(f.active_flows), AVG(f.latency_ms),
                MAX(f.bps), MAX(f.active_flows), MAX(f.latency_ms),
                CAST(strftime('%H', s.started_at) AS INTEGER),
                CAST(strftime('%w', s.started_at) AS INTEGER)
         FROM frames f
         JOIN sessions s ON s.id = f.session_id
         WHERE f.session_id = ?1",
        params![session_id],
        |row| {
            Ok((
                row.get::<_, f64>(0).unwrap_or(0.0),
                row.get::<_, f64>(1).unwrap_or(0.0),
                row.get::<_, f64>(2).unwrap_or(0.0),
                row.get::<_, f64>(3).unwrap_or(0.0),
                row.get::<_, f64>(4).unwrap_or(0.0),
                row.get::<_, f64>(5).unwrap_or(0.0),
                row.get::<_, i32>(6).unwrap_or(0),
                row.get::<_, i32>(7).unwrap_or(0),
            ))
        },
    );

    let (_avg_bps, _avg_flows, _avg_lat, peak_bps, peak_flows, peak_lat, hour, dow) =
        match session_stats {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(anomalies),
            Err(e) => return Err(e),
        };

    // Get the baseline for this time slot
    let baseline = match get_baseline_for_time(conn, hour, dow)? {
        Some(b) => b,
        None => return Ok(anomalies), // no baseline data yet
    };

    if baseline.sample_count < 5 {
        return Ok(anomalies); // not enough data to compare
    }

    // Check throughput spike (peak vs baseline)
    if baseline.stddev_bps > 0.0 {
        let sigmas = (peak_bps - baseline.avg_bps) / baseline.stddev_bps;
        if sigmas.is_finite() && sigmas > 2.0 {
            let severity = if sigmas > 4.0 { "high" } else if sigmas > 3.0 { "medium" } else { "low" };
            anomalies.push(Anomaly {
                anomaly_type: "THROUGHPUT_SPIKE".to_string(),
                severity: severity.to_string(),
                message: format!(
                    "Peak throughput {}/s is {:.1}σ above baseline {}/s",
                    format_bytes_human(peak_bps),
                    sigmas,
                    format_bytes_human(baseline.avg_bps)
                ),
                current_value: peak_bps,
                baseline_avg: baseline.avg_bps,
                baseline_stddev: baseline.stddev_bps,
                deviation_sigmas: sigmas,
            });
        }
    }

    // Check latency spike
    if baseline.stddev_latency > 0.0 {
        let sigmas = (peak_lat - baseline.avg_latency_ms) / baseline.stddev_latency;
        if sigmas.is_finite() && sigmas > 2.0 {
            let severity = if sigmas > 4.0 { "high" } else if sigmas > 3.0 { "medium" } else { "low" };
            anomalies.push(Anomaly {
                anomaly_type: "LATENCY_SPIKE".to_string(),
                severity: severity.to_string(),
                message: format!(
                    "Peak latency {:.0}ms is {:.1}σ above baseline {:.0}ms",
                    peak_lat, sigmas, baseline.avg_latency_ms
                ),
                current_value: peak_lat,
                baseline_avg: baseline.avg_latency_ms,
                baseline_stddev: baseline.stddev_latency,
                deviation_sigmas: sigmas,
            });
        }
    }

    // Check excessive flows
    if baseline.stddev_flows > 0.0 {
        let sigmas = (peak_flows - baseline.avg_flows) / baseline.stddev_flows;
        if sigmas.is_finite() && sigmas > 3.0 {
            let severity = if sigmas > 5.0 { "high" } else if sigmas > 4.0 { "medium" } else { "low" };
            anomalies.push(Anomaly {
                anomaly_type: "EXCESSIVE_FLOWS".to_string(),
                severity: severity.to_string(),
                message: format!(
                    "Peak flow count {:.0} is {:.1}σ above baseline {:.0}",
                    peak_flows, sigmas, baseline.avg_flows
                ),
                current_value: peak_flows,
                baseline_avg: baseline.avg_flows,
                baseline_stddev: baseline.stddev_flows,
                deviation_sigmas: sigmas,
            });
        }
    }

    // Check unusual processes — processes in this session not in the common list
    // LIMIT to avoid scanning all flow_snapshots for very long sessions
    let session_procs: Vec<String> = conn
        .prepare(
            "SELECT DISTINCT process FROM flow_snapshots
             WHERE session_id = ?1 AND process IS NOT NULL AND process != ''
             LIMIT 100",
        )?
        .query_map(params![session_id], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    for proc in &session_procs {
        if !baseline.common_processes.iter().any(|p| p == proc) {
            anomalies.push(Anomaly {
                anomaly_type: "UNUSUAL_PROCESS".to_string(),
                severity: "low".to_string(),
                message: format!("Process '{proc}' not seen in baseline"),
                current_value: 0.0,
                baseline_avg: 0.0,
                baseline_stddev: 0.0,
                deviation_sigmas: 0.0,
            });
        }
    }

    // Check new countries
    // LIMIT to avoid scanning all flow_snapshots for very long sessions
    let session_countries: Vec<String> = conn
        .prepare(
            "SELECT DISTINCT dst_country FROM flow_snapshots
             WHERE session_id = ?1 AND dst_country IS NOT NULL AND dst_country != ''
             LIMIT 50",
        )?
        .query_map(params![session_id], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    for country in &session_countries {
        if !baseline.common_countries.iter().any(|c| c == country) {
            anomalies.push(Anomaly {
                anomaly_type: "NEW_COUNTRY".to_string(),
                severity: "low".to_string(),
                message: format!("Connection to '{country}' — not in baseline"),
                current_value: 0.0,
                baseline_avg: 0.0,
                baseline_stddev: 0.0,
                deviation_sigmas: 0.0,
            });
        }
    }

    // Check unusual ports — not in standard services list
    static STANDARD_PORTS: &[i64] = &[
        20, 21, 22, 25, 53, 67, 68, 80, 110, 123, 143, 161, 194,
        389, 443, 445, 465, 514, 587, 636, 853, 993, 995,
        1080, 1194, 1433, 1521, 1723, 3306, 3389, 5060, 5222,
        5228, 5353, 5432, 5900, 5938, 6379, 8080, 8443, 8888,
        9090, 9443, 27017,
    ];

    let session_ports: Vec<i64> = conn
        .prepare(
            "SELECT DISTINCT port FROM flow_snapshots
             WHERE session_id = ?1 AND port IS NOT NULL AND port > 0",
        )?
        .query_map(params![session_id], |row| row.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .collect();

    for &port in &session_ports {
        // Only flag registered service ports (1-49151) that aren't in the standard set.
        // Ports >= 49152 are ephemeral/dynamic and expected to vary.
        // Ports 1024-49151 that aren't standard may indicate unusual services.
        if !STANDARD_PORTS.contains(&port) && port > 0 && port < 49152 {
            // Ports 1-1023 are well-known — flag at medium severity if not standard
            // Ports 1024-49151 are registered — flag at low severity
            let sev = if port <= 1023 { "medium" } else { "low" };
            anomalies.push(Anomaly {
                anomaly_type: "UNUSUAL_PORT".to_string(),
                severity: sev.to_string(),
                message: format!("Connection on non-standard port {port}"),
                current_value: port as f64,
                baseline_avg: 0.0,
                baseline_stddev: 0.0,
                deviation_sigmas: 0.0,
            });
        }
    }

    // Limit to avoid overwhelming UI
    anomalies.truncate(20);
    Ok(anomalies)
}

/// Network health score (0-100) for the current baseline period.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HealthScore {
    pub score: u32,
    pub latency_score: u32,      // 0-25 (lower latency = higher score)
    pub stability_score: u32,    // 0-25 (less throughput variance = higher)
    pub diversity_score: u32,    // 0-25 (healthy protocol mix = higher)
    pub anomaly_score: u32,      // 0-25 (fewer anomalies = higher)
    pub details: String,
}

/// Compute a network health score from the last N hours of data.
pub fn compute_health_score(conn: &Connection, hours: u32) -> SqlResult<HealthScore> {
    let hours = if hours == 0 { 24 } else { hours };

    // Check if we have any data in the time range
    let frame_count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM frames f
             JOIN sessions s ON s.id = f.session_id
             WHERE (julianday('now') - julianday(f.timestamp)) * 24 <= ?1",
            params![hours],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if frame_count == 0 {
        return Ok(HealthScore {
            score: 0,
            latency_score: 0,
            stability_score: 0,
            diversity_score: 0,
            anomaly_score: 0,
            details: "No data available — start recording to compute health score".to_string(),
        });
    }

    // Latency score: avg latency in last N hours → 0-25
    let (avg_lat, _lat_var): (f64, f64) = conn
        .query_row(
            "SELECT COALESCE(AVG(f.latency_ms), 0),
                    CASE WHEN COUNT(*) > 1
                         THEN COALESCE(AVG(f.latency_ms * f.latency_ms) - AVG(f.latency_ms) * AVG(f.latency_ms), 0)
                         ELSE 0 END
             FROM frames f
             JOIN sessions s ON s.id = f.session_id
             WHERE (julianday('now') - julianday(f.timestamp)) * 24 <= ?1",
            params![hours],
            |row| Ok((row.get::<_, f64>(0).unwrap_or(0.0), row.get::<_, f64>(1).unwrap_or(0.0))),
        )
        .unwrap_or((0.0, 0.0));

    // Lower latency → higher score: 0ms=25, 100ms=12, 500ms+=0
    let latency_score = if avg_lat <= 0.0 {
        25u32
    } else {
        (25.0 * (1.0 - (avg_lat / 500.0).min(1.0))).round() as u32
    };

    // Stability score: low coefficient of variation in bps → higher score
    let (avg_bps, bps_var): (f64, f64) = conn
        .query_row(
            "SELECT COALESCE(AVG(f.bps), 0),
                    CASE WHEN COUNT(*) > 1
                         THEN COALESCE(AVG(f.bps * f.bps) - AVG(f.bps) * AVG(f.bps), 0)
                         ELSE 0 END
             FROM frames f
             JOIN sessions s ON s.id = f.session_id
             WHERE (julianday('now') - julianday(f.timestamp)) * 24 <= ?1",
            params![hours],
            |row| Ok((row.get::<_, f64>(0).unwrap_or(0.0), row.get::<_, f64>(1).unwrap_or(0.0))),
        )
        .unwrap_or((0.0, 0.0));

    let cv = if avg_bps > 0.0 {
        let raw_cv = (bps_var.max(0.0).sqrt()) / avg_bps;
        if raw_cv.is_finite() { raw_cv } else { 0.0 }
    } else {
        0.0
    };
    // CV 0=stable=25, CV 2+=very unstable=0
    let stability_score = (25.0 * (1.0 - (cv / 2.0).min(1.0))).round() as u32;

    // Protocol diversity: ratio of unique protocols used
    let (proto_tcp, proto_udp, proto_dns, proto_https, proto_http, proto_other) = conn
        .query_row(
            "SELECT COALESCE(SUM(f.proto_tcp), 0), COALESCE(SUM(f.proto_udp), 0),
                    COALESCE(SUM(f.proto_dns), 0), COALESCE(SUM(f.proto_https), 0),
                    COALESCE(SUM(f.proto_http), 0), COALESCE(SUM(f.proto_other), 0)
             FROM frames f
             JOIN sessions s ON s.id = f.session_id
             WHERE (julianday('now') - julianday(f.timestamp)) * 24 <= ?1",
            params![hours],
            |row| {
                Ok((
                    row.get::<_, i64>(0).unwrap_or(0),
                    row.get::<_, i64>(1).unwrap_or(0),
                    row.get::<_, i64>(2).unwrap_or(0),
                    row.get::<_, i64>(3).unwrap_or(0),
                    row.get::<_, i64>(4).unwrap_or(0),
                    row.get::<_, i64>(5).unwrap_or(0),
                ))
            },
        )
        .unwrap_or((0, 0, 0, 0, 0, 0));

    let used_protos = [proto_tcp, proto_udp, proto_dns, proto_https, proto_http, proto_other]
        .iter()
        .filter(|&&v| v > 0)
        .count();
    // 6 protocols used = 25, 1 = ~4, 0 = 0
    let diversity_score = if used_protos > 0 {
        ((used_protos as f64 / 6.0) * 25.0).round() as u32
    } else {
        0
    };

    // Anomaly score: check recent sessions for anomalies
    // Only check up to 3 most recent sessions to keep computation fast
    let recent_sessions: Vec<String> = conn
        .prepare(
            "SELECT id FROM sessions
             WHERE ended_at IS NOT NULL
               AND (julianday('now') - julianday(started_at)) * 24 <= ?1
             ORDER BY started_at DESC
             LIMIT 3",
        )?
        .query_map(params![hours], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut total_anomalies = 0usize;
    for sid in &recent_sessions {
        if let Ok(anomalies) = detect_anomalies(conn, sid) {
            total_anomalies += anomalies.iter().filter(|a| a.severity != "low").count();
        }
        // Early exit: if we already have enough anomalies to hit the cap (5+), skip remaining
        if total_anomalies >= 5 {
            break;
        }
    }
    // 0 anomalies=25, 5+=0
    let anomaly_score = (25.0 * (1.0 - (total_anomalies as f64 / 5.0).min(1.0))).round() as u32;

    let total = latency_score + stability_score + diversity_score + anomaly_score;

    let details = if total >= 80 {
        "Excellent network health".to_string()
    } else if total >= 60 {
        "Good network health".to_string()
    } else if total >= 40 {
        "Fair network health — some issues detected".to_string()
    } else {
        "Poor network health — significant issues".to_string()
    };

    Ok(HealthScore {
        score: total,
        latency_score,
        stability_score,
        diversity_score,
        anomaly_score,
        details,
    })
}

/// Search sessions by name, tags, or notes.
pub fn search_sessions(
    conn: &Connection,
    query: &str,
    limit: u32,
) -> SqlResult<Vec<SessionInfo>> {
    // Escape LIKE wildcards so user input like "%" or "_" are literal
    let escaped = query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pattern = format!("%{escaped}%");
    let mut stmt = conn.prepare(
        "SELECT id, name, started_at, ended_at, duration_secs,
                total_bytes_up, total_bytes_down, total_flows,
                peak_bps, peak_flows, avg_latency_ms,
                local_city, local_country, local_lat, local_lng,
                notes, tags, crash_recovered
         FROM sessions
         WHERE name LIKE ?1 ESCAPE '\\'
            OR tags LIKE ?1 ESCAPE '\\'
            OR notes LIKE ?1 ESCAPE '\\'
         ORDER BY started_at DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![pattern, limit], |row| {
            let ended_at: Option<String> = row.get(3)?;
            let crash_recovered: bool = row.get::<_, i32>(17).unwrap_or(0) != 0;
            let status = if ended_at.is_none() {
                "recording".to_string()
            } else if crash_recovered {
                "crashed".to_string()
            } else {
                "complete".to_string()
            };
            Ok(SessionInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                started_at: row.get(2)?,
                ended_at,
                duration_secs: row.get(4)?,
                total_bytes_up: row.get::<_, f64>(5).unwrap_or(0.0),
                total_bytes_down: row.get::<_, f64>(6).unwrap_or(0.0),
                total_flows: row.get::<_, i64>(7).unwrap_or(0),
                peak_bps: row.get::<_, f64>(8).unwrap_or(0.0),
                peak_flows: row.get::<_, i64>(9).unwrap_or(0),
                avg_latency_ms: row.get::<_, f64>(10).unwrap_or(0.0),
                local_city: row.get::<_, String>(11).unwrap_or_default(),
                local_country: row.get::<_, String>(12).unwrap_or_default(),
                local_lat: row.get::<_, f64>(13).unwrap_or(0.0),
                local_lng: row.get::<_, f64>(14).unwrap_or(0.0),
                notes: row.get::<_, String>(15).unwrap_or_default(),
                tags: row.get::<_, String>(16).unwrap_or_else(|_| "[]".to_string()),
                status,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Update tags for a session.
pub fn update_session_tags(conn: &Connection, session_id: &str, tags: &[String]) -> SqlResult<()> {
    // Limit tags: max 20, each max 50 chars
    let clamped: Vec<String> = tags
        .iter()
        .take(20)
        .map(|t| if t.len() > 50 { t[..50].to_string() } else { t.clone() })
        .collect();
    let tags_json = serde_json::to_string(&clamped).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "UPDATE sessions SET tags = ?1 WHERE id = ?2",
        params![tags_json, session_id],
    )?;
    Ok(())
}
