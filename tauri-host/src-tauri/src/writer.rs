use crate::db;
use crate::{GeoFlow, TelemetryFrame};
use chrono::Utc;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;

// ─── Configuration ──────────────────────────────────────────────────────────

/// How often (in ticks) to persist a full frame snapshot.
const FRAME_SAMPLE_INTERVAL: u32 = 5; // every 5 seconds
/// How often (in ticks) to persist flow snapshots.
const FLOW_SAMPLE_INTERVAL: u32 = 10; // every 10 seconds
/// How often (in ticks) to aggregate per-process usage.
const PROCESS_AGG_INTERVAL: u32 = 30; // every 30 seconds
/// How often (in ticks) to update session running totals.
const TOTALS_UPDATE_INTERVAL: u32 = 5; // every 5 seconds
/// How often (in ticks) to upsert destinations.
const DEST_UPDATE_INTERVAL: u32 = 10; // every 10 seconds

// ─── Write commands ─────────────────────────────────────────────────────────

/// Commands sent from the monitor loop to the writer thread.
pub enum WriteCommand {
    /// A new telemetry frame to potentially persist.
    Frame(Box<TelemetryFrame>),
    /// Start a new session.
    StartSession {
        id: String,
        name: String,
        local_city: String,
        local_country: String,
        local_lat: f64,
        local_lng: f64,
    },
    /// End the current session.
    EndSession { id: String },
    /// Update session metadata (name, notes, tags).
    UpdateMeta {
        id: String,
        name: Option<String>,
        notes: Option<String>,
        tags: Option<String>,
    },
    /// Shut down the writer thread.
    Shutdown,
}

/// Creates the mpsc channel pair for sending write commands.
pub fn create_channel() -> (mpsc::Sender<WriteCommand>, mpsc::Receiver<WriteCommand>) {
    mpsc::channel()
}

// ─── Writer thread ──────────────────────────────────────────────────────────

/// Runs the blocking writer loop on a dedicated thread.
/// Receives `WriteCommand`s and batches writes to SQLite.
pub fn writer_thread(rx: mpsc::Receiver<WriteCommand>, db_path: PathBuf) {
    let conn = match db::open_database(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[Abyss][writer] Failed to open database: {e}");
            return;
        }
    };

    // Recover any crashed sessions from previous runs
    match db::recover_crashed_sessions(&conn) {
        Ok(0) => {}
        Ok(n) => println!("[Abyss][writer] Recovered {n} crashed session(s)"),
        Err(e) => eprintln!("[Abyss][writer] Crash recovery failed: {e}"),
    }

    let mut state = WriterState::new();

    for cmd in rx.iter() {
        match cmd {
            WriteCommand::Frame(frame) => {
                state.handle_frame(&conn, &frame);
            }
            WriteCommand::StartSession {
                id,
                name,
                local_city,
                local_country,
                local_lat,
                local_lng,
            } => {
                state.handle_start_session(&conn, &id, &name, &local_city, &local_country, local_lat, local_lng);
            }
            WriteCommand::EndSession { id } => {
                state.handle_end_session(&conn, &id);
            }
            WriteCommand::UpdateMeta {
                id,
                name,
                notes,
                tags,
            } => {
                if let Err(e) = db::update_session_meta(
                    &conn,
                    &id,
                    name.as_deref(),
                    notes.as_deref(),
                    tags.as_deref(),
                ) {
                    eprintln!("[Abyss][writer] Failed to update session meta: {e}");
                }
            }
            WriteCommand::Shutdown => {
                // Finalize any open session before exiting
                if let Some(sid) = &state.current_session_id {
                    let now = Utc::now().to_rfc3339();
                    if let Err(e) = db::finalize_session(&conn, sid, &now) {
                        eprintln!("[Abyss][writer] Failed to finalize session on shutdown: {e}");
                    } else {
                        println!("[Abyss][writer] Finalized session {sid} on shutdown");
                    }
                }
                println!("[Abyss][writer] Shut down cleanly");
                break;
            }
        }
    }
}

// ─── Internal state ─────────────────────────────────────────────────────────

struct WriterState {
    current_session_id: Option<String>,
    tick_counter: u32,
    /// Track which destination IPs we've already seen in this session
    /// to decide when to upsert (dedup within the destination-update interval).
    seen_dest_ips: HashMap<String, bool>,
}

impl WriterState {
    fn new() -> Self {
        Self {
            current_session_id: None,
            tick_counter: 0,
            seen_dest_ips: HashMap::new(),
        }
    }

    fn handle_start_session(
        &mut self,
        conn: &Connection,
        id: &str,
        name: &str,
        local_city: &str,
        local_country: &str,
        local_lat: f64,
        local_lng: f64,
    ) {
        let now = Utc::now().to_rfc3339();
        match db::insert_session(conn, id, name, &now, local_city, local_country, local_lat, local_lng) {
            Ok(_) => {
                println!("[Abyss][writer] Started session '{name}' ({id})");
                self.current_session_id = Some(id.to_string());
                self.tick_counter = 0;
                self.seen_dest_ips.clear();
            }
            Err(e) => {
                eprintln!("[Abyss][writer] Failed to start session: {e}");
            }
        }
    }

    fn handle_end_session(&mut self, conn: &Connection, id: &str) {
        let now = Utc::now().to_rfc3339();
        match db::finalize_session(conn, id, &now) {
            Ok(_) => {
                println!("[Abyss][writer] Ended session {id}");
                self.current_session_id = None;
                self.tick_counter = 0;
                self.seen_dest_ips.clear();
            }
            Err(e) => {
                eprintln!("[Abyss][writer] Failed to finalize session: {e}");
            }
        }
    }

    fn handle_frame(&mut self, conn: &Connection, frame: &TelemetryFrame) {
        let session_id = match &self.current_session_id {
            Some(id) => id.clone(),
            None => return, // No active session, skip
        };

        self.tick_counter += 1;
        let tick = self.tick_counter;
        let now = Utc::now().to_rfc3339();

        // 1) Persist frame snapshot at FRAME_SAMPLE_INTERVAL
        let frame_row_id = if tick % FRAME_SAMPLE_INTERVAL == 0 {
            match db::insert_frame(
                conn,
                &session_id,
                frame.t,
                &now,
                frame.net.bps,
                frame.net.pps,
                frame.net.active_flows,
                frame.net.latency_ms,
                frame.net.upload_bps,
                frame.net.download_bps,
                frame.proto.tcp,
                frame.proto.udp,
                frame.proto.icmp,
                frame.proto.dns,
                frame.proto.https,
                frame.proto.http,
                frame.proto.other,
            ) {
                Ok(id) => Some(id),
                Err(e) => {
                    eprintln!("[Abyss][writer] insert_frame failed: {e}");
                    None
                }
            }
        } else {
            None
        };

        // 2) Persist flow snapshots at FLOW_SAMPLE_INTERVAL
        // Only persisted when a frame was also successfully inserted (FK integrity)
        if tick % FLOW_SAMPLE_INTERVAL == 0 {
            if let Some(fid) = frame_row_id {
                self.persist_flows(conn, &session_id, fid, &frame.flows);
            }
        }

        // 3) Update session running totals
        if tick % TOTALS_UPDATE_INTERVAL == 0 {
            // Estimate bytes transferred in this interval
            let interval_secs = TOTALS_UPDATE_INTERVAL as f64;
            let bytes_up = (frame.net.upload_bps / 8.0) * interval_secs;
            let bytes_down = (frame.net.download_bps / 8.0) * interval_secs;

            if let Err(e) = db::update_session_totals(
                conn,
                &session_id,
                bytes_up,
                bytes_down,
                frame.net.bps,
                frame.net.active_flows,
                frame.net.latency_ms,
                0, // new_unique_flows counted separately
            ) {
                eprintln!("[Abyss][writer] update_session_totals failed: {e}");
            }
        }

        // 4) Upsert destinations
        if tick % DEST_UPDATE_INTERVAL == 0 {
            self.upsert_destinations(conn, &session_id, frame.t, &frame.flows);
        }

        // 5) Aggregate per-process usage
        if tick % PROCESS_AGG_INTERVAL == 0 {
            self.aggregate_process_usage(conn, &session_id, &now, &frame.flows);
        }
    }

    fn persist_flows(
        &self,
        conn: &Connection,
        session_id: &str,
        frame_id: i64,
        flows: &[GeoFlow],
    ) {
        // Use a transaction for batching
        if let Err(e) = conn.execute_batch("BEGIN TRANSACTION;") {
            eprintln!("[Abyss][writer] begin tx failed: {e}");
            return;
        }

        for flow in flows {
            let protocol_str = match flow.protocol {
                1 => "tcp",
                2 => "udp",
                3 => "icmp",
                _ => "other",
            };
            let service_str = flow.service.map(|s| match s {
                1 => "FTP",
                2 => "SSH",
                3 => "SMTP",
                4 => "DNS",
                5 => "HTTP",
                6 => "POP3",
                7 => "IMAP",
                8 => "HTTPS",
                9 => "SMTPS",
                10 => "SMTP",
                11 => "IMAPS",
                12 => "POP3S",
                13 => "MSSQL",
                14 => "MySQL",
                15 => "RDP",
                16 => "Postgres",
                17 => "VNC",
                18 => "Redis",
                19 => "HTTP-Alt",
                20 => "HTTPS-Alt",
                21 => "MongoDB",
                22 => "Prometheus",
                _ => "Unknown",
            });

            if let Err(e) = db::insert_flow_snapshot(
                conn,
                session_id,
                frame_id,
                &flow.id,
                &flow.src.ip,
                &flow.src.city,
                &flow.src.country,
                &flow.dst.ip,
                flow.dst.lat,
                flow.dst.lng,
                &flow.dst.city,
                &flow.dst.country,
                flow.dst.asn.as_deref(),
                flow.dst.org.as_deref(),
                flow.bps,
                flow.pps,
                flow.rtt,
                protocol_str,
                &flow.dir,
                flow.port,
                service_str,
                flow.started_at,
                flow.process.as_deref(),
                flow.pid,
            ) {
                eprintln!("[Abyss][writer] insert_flow_snapshot failed: {e}");
            }
        }

        if let Err(e) = conn.execute_batch("COMMIT;") {
            eprintln!("[Abyss][writer] commit failed: {e}");
            let _ = conn.execute_batch("ROLLBACK;");
        }
    }

    fn upsert_destinations(
        &mut self,
        conn: &Connection,
        session_id: &str,
        t: f64,
        flows: &[GeoFlow],
    ) {
        if flows.is_empty() {
            return;
        }

        if let Err(e) = conn.execute_batch("BEGIN TRANSACTION;") {
            eprintln!("[Abyss][writer] begin dest tx failed: {e}");
            return;
        }

        for flow in flows {
            let bytes_est = flow.bps / 8.0; // 1-second worth
            let service_str = flow.service.map(|s| match s {
                4 => "DNS",
                5 => "HTTP",
                8 => "HTTPS",
                _ => "Other",
            });

            if let Err(e) = db::upsert_destination(
                conn,
                session_id,
                &flow.dst.ip,
                &flow.dst.city,
                &flow.dst.country,
                flow.dst.asn.as_deref(),
                flow.dst.org.as_deref(),
                t,
                bytes_est,
                service_str,
                flow.process.as_deref(),
            ) {
                eprintln!("[Abyss][writer] upsert_destination failed for {}: {e}", flow.dst.ip);
            }

            self.seen_dest_ips.insert(flow.dst.ip.clone(), true);
        }

        if let Err(e) = conn.execute_batch("COMMIT;") {
            eprintln!("[Abyss][writer] commit dest tx failed: {e}");
            let _ = conn.execute_batch("ROLLBACK;");
        }
    }

    fn aggregate_process_usage(
        &self,
        conn: &Connection,
        session_id: &str,
        timestamp: &str,
        flows: &[GeoFlow],
    ) {
        // Aggregate by process name
        struct Accum {
            bytes_up: f64,
            bytes_down: f64,
            flow_count: u32,
            total_rtt: f64,
            rtt_samples: u32,
        }

        let mut by_process: HashMap<String, Accum> = HashMap::new();
        let interval_secs = PROCESS_AGG_INTERVAL as f64;

        for flow in flows {
            let name = flow
                .process
                .as_deref()
                .unwrap_or("System")
                .to_string();
            let entry = by_process.entry(name).or_insert(Accum {
                bytes_up: 0.0,
                bytes_down: 0.0,
                flow_count: 0,
                total_rtt: 0.0,
                rtt_samples: 0,
            });

            let bytes_per_sec = flow.bps / 8.0;
            match flow.dir.as_str() {
                "up" => entry.bytes_up += bytes_per_sec * interval_secs,
                "down" => entry.bytes_down += bytes_per_sec * interval_secs,
                _ => {
                    entry.bytes_up += bytes_per_sec * interval_secs / 2.0;
                    entry.bytes_down += bytes_per_sec * interval_secs / 2.0;
                }
            }
            entry.flow_count += 1;
            entry.total_rtt += flow.rtt;
            entry.rtt_samples += 1;
        }

        if let Err(e) = conn.execute_batch("BEGIN TRANSACTION;") {
            eprintln!("[Abyss][writer] begin process_usage tx failed: {e}");
            return;
        }

        for (process_name, accum) in &by_process {
            let avg_rtt = if accum.rtt_samples > 0 {
                accum.total_rtt / accum.rtt_samples as f64
            } else {
                0.0
            };

            if let Err(e) = db::insert_process_usage(
                conn,
                session_id,
                timestamp,
                process_name,
                accum.bytes_up,
                accum.bytes_down,
                accum.flow_count,
                avg_rtt,
            ) {
                eprintln!("[Abyss][writer] insert_process_usage failed: {e}");
            }
        }

        if let Err(e) = conn.execute_batch("COMMIT;") {
            eprintln!("[Abyss][writer] commit process_usage failed: {e}");
            let _ = conn.execute_batch("ROLLBACK;");
        }
    }
}
