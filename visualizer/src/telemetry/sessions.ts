import { invoke } from "@tauri-apps/api/core";

// ─── Types mirroring Rust db.rs serialized structs ──────────────────────────

export interface SessionInfo {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  durationSecs: number | null;
  totalBytesUp: number;
  totalBytesDown: number;
  totalFlows: number;
  peakBps: number;
  peakFlows: number;
  avgLatencyMs: number;
  localCity: string;
  localCountry: string;
  localLat: number;
  localLng: number;
  notes: string;
  tags: string;
  status: "recording" | "complete" | "crashed";
}

export interface FrameRecord {
  t: number;
  timestamp: string;
  bps: number;
  uploadBps: number;
  downloadBps: number;
  activeFlows: number;
  latencyMs: number;
  pps: number;
}

export interface FlowSnapshotRecord {
  flowId: string;
  srcIp: string | null;
  srcCity: string | null;
  srcCountry: string | null;
  dstIp: string;
  dstLat: number | null;
  dstLng: number | null;
  dstCity: string | null;
  dstCountry: string | null;
  dstOrg: string | null;
  bps: number;
  pps: number;
  rtt: number;
  protocol: string | null;
  dir: string | null;
  port: number | null;
  service: string | null;
  process: string | null;
  pid: number | null;
}

export interface DestinationRecord {
  ip: string;
  city: string | null;
  country: string | null;
  asn: string | null;
  org: string | null;
  firstSeen: number | null;
  lastSeen: number | null;
  totalBytes: number;
  connectionCount: number;
  primaryService: string | null;
  primaryProcess: string | null;
}

export interface ProcessUsageRecord {
  timestamp: string;
  processName: string;
  bytesUp: number;
  bytesDown: number;
  flowCount: number;
  avgRtt: number;
}

export interface GlobalStats {
  totalSessions: number;
  totalRecordingHours: number;
  totalBytesTransferred: number;
  databaseSizeMb: number;
  oldestSession: string | null;
  newestSession: string | null;
}

// ─── Analytics types (Tier 4) ───────────────────────────────────────────────

export interface DailyUsage {
  date: string; // "YYYY-MM-DD"
  bytesUp: number;
  bytesDown: number;
  sessionCount: number;
  totalDurationSecs: number;
}

export interface TopDestination {
  ip: string;
  city: string;
  country: string;
  org: string;
  totalBytes: number;
  connectionCount: number;
  primaryService: string;
  primaryProcess: string;
}

export interface TopApp {
  processName: string;
  totalBytesUp: number;
  totalBytesDown: number;
  totalFlows: number;
  avgRtt: number;
}

// ─── Session Insights ───────────────────────────────────────────────────────

export interface LongestConnectionInfo {
  dstIp: string;
  service: string;
  durationSecs: number;
}

export interface SessionInsights {
  totalDataHuman: string;
  busiestMinute: string;
  mostActiveProcess: string;
  uniqueCountries: number;
  uniqueDestinations: number;
  highLatencyDestinations: string[];
  topServices: string[];
  unusualPorts: number[];
  longestConnection: LongestConnectionInfo | null;
}

// ─── Playback types ─────────────────────────────────────────────────────────

export interface PlaybackFrameRecord {
  frameId: number;
  t: number;
  bps: number;
  uploadBps: number;
  downloadBps: number;
  activeFlows: number;
  latencyMs: number;
  pps: number;
  protoTcp: number;
  protoUdp: number;
  protoIcmp: number;
  protoDns: number;
  protoHttps: number;
  protoHttp: number;
  protoOther: number;
}

export interface PlaybackFlowRecord {
  frameId: number;
  flowId: string;
  srcIp: string;
  srcCity: string;
  srcCountry: string;
  dstIp: string;
  dstLat: number;
  dstLng: number;
  dstCity: string;
  dstCountry: string;
  dstOrg: string;
  bps: number;
  pps: number;
  rtt: number;
  protocol: string;
  dir: string;
  port: number;
  service: string;
  startedAt: number;
  process: string;
  pid: number;
}

export interface PlaybackData {
  session: SessionInfo;
  frames: PlaybackFrameRecord[];
  flows: PlaybackFlowRecord[];
}

// ─── Tauri command wrappers ─────────────────────────────────────────────────

export async function listSessions(
  limit = 50,
  offset = 0,
): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("cmd_list_sessions", { limit, offset });
}

export async function getSession(id: string): Promise<SessionInfo | null> {
  return invoke<SessionInfo | null>("cmd_get_session", { id });
}

export async function deleteSession(id: string): Promise<boolean> {
  return invoke<boolean>("cmd_delete_session", { id });
}

export async function getSessionFrames(
  sessionId: string,
  opts?: { startT?: number; endT?: number; maxPoints?: number },
): Promise<FrameRecord[]> {
  return invoke<FrameRecord[]>("cmd_get_session_frames", {
    sessionId,
    startT: opts?.startT ?? null,
    endT: opts?.endT ?? null,
    maxPoints: opts?.maxPoints ?? null,
  });
}

export async function getSessionFlows(
  sessionId: string,
  opts?: {
    processFilter?: string;
    countryFilter?: string;
    limit?: number;
  },
): Promise<FlowSnapshotRecord[]> {
  return invoke<FlowSnapshotRecord[]>("cmd_get_session_flows", {
    sessionId,
    processFilter: opts?.processFilter ?? null,
    countryFilter: opts?.countryFilter ?? null,
    limit: opts?.limit ?? 100,
  });
}

export async function getSessionDestinations(
  sessionId: string,
  opts?: { sortBy?: "bytes" | "connections" | "first_seen"; limit?: number },
): Promise<DestinationRecord[]> {
  return invoke<DestinationRecord[]>("cmd_get_session_destinations", {
    sessionId,
    sortBy: opts?.sortBy ?? "bytes",
    limit: opts?.limit ?? 50,
  });
}

export async function getProcessUsage(
  sessionId: string,
  opts?: { processName?: string; limit?: number },
): Promise<ProcessUsageRecord[]> {
  return invoke<ProcessUsageRecord[]>("cmd_get_process_usage", {
    sessionId,
    processName: opts?.processName ?? null,
    limit: opts?.limit ?? 500,
  });
}

export async function getGlobalStats(): Promise<GlobalStats> {
  return invoke<GlobalStats>("cmd_get_global_stats");
}

export async function getDailyUsage(rangeDays = 0): Promise<DailyUsage[]> {
  return invoke<DailyUsage[]>("cmd_get_daily_usage", { rangeDays });
}

export async function getTopDestinations(
  rangeDays = 0,
  limit = 20,
): Promise<TopDestination[]> {
  return invoke<TopDestination[]>("cmd_get_top_destinations", {
    rangeDays,
    limit,
  });
}

export async function getTopApps(rangeDays = 0, limit = 20): Promise<TopApp[]> {
  return invoke<TopApp[]>("cmd_get_top_apps", { rangeDays, limit });
}

export async function getSessionInsights(
  sessionId: string,
): Promise<SessionInsights> {
  return invoke<SessionInsights>("cmd_get_session_insights", { sessionId });
}

export async function updateSessionMeta(
  id: string,
  meta: { name?: string; notes?: string; tags?: string },
): Promise<void> {
  return invoke<void>("cmd_update_session_meta", {
    id,
    name: meta.name ?? null,
    notes: meta.notes ?? null,
    tags: meta.tags ?? null,
  });
}

export async function startSession(name?: string): Promise<string> {
  return invoke<string>("cmd_start_session", { name: name ?? null });
}

export async function stopSession(): Promise<string | null> {
  return invoke<string | null>("cmd_stop_session");
}

export async function getCurrentSession(): Promise<string | null> {
  return invoke<string | null>("cmd_get_current_session");
}

export async function cleanupSessions(days = 90): Promise<number> {
  return invoke<number>("cmd_cleanup_sessions", { days });
}

export async function cleanupExcessSessions(maxCount: number): Promise<number> {
  return invoke<number>("cmd_cleanup_excess_sessions", { maxCount });
}

export async function deleteAllSessions(): Promise<number> {
  return invoke<number>("cmd_delete_all_sessions");
}

export async function getDatabasePath(): Promise<string> {
  return invoke<string>("cmd_get_database_path");
}

export async function openDataFolder(): Promise<void> {
  return invoke<void>("cmd_open_data_folder");
}

export async function exportSessionCsv(
  sessionId: string,
  path: string,
): Promise<string> {
  return invoke<string>("cmd_export_session_csv", { sessionId, path });
}

export async function exportSessionJson(
  sessionId: string,
  path: string,
): Promise<string> {
  return invoke<string>("cmd_export_session_json", { sessionId, path });
}

export async function getPlaybackData(
  sessionId: string,
): Promise<PlaybackData> {
  return invoke<PlaybackData>("cmd_get_playback_data", { sessionId });
}

// ─── Utility helpers (re-exported from lib/utils for backward compatibility) ─

export {
  formatDataSize as formatBytes,
  formatDuration,
  formatTimestamp,
} from "../lib/utils";

// ─── Tier 6: Baseline, Anomaly, Health Score, Tagging/Search ────────────────

export interface BaselineEntry {
  hourOfDay: number;
  dayOfWeek: number;
  avgBps: number;
  stddevBps: number;
  avgFlows: number;
  stddevFlows: number;
  avgLatencyMs: number;
  stddevLatency: number;
  commonProcesses: string[];
  commonCountries: string[];
  sampleCount: number;
}

export interface Anomaly {
  anomalyType: string;
  severity: "low" | "medium" | "high";
  message: string;
  currentValue: number;
  baselineAvg: number;
  baselineStddev: number;
  deviationSigmas: number;
}

export interface HealthScore {
  score: number;
  latencyScore: number;
  stabilityScore: number;
  diversityScore: number;
  anomalyScore: number;
  details: string;
}

export async function computeBaseline(rangeDays?: number): Promise<number> {
  return invoke<number>("cmd_compute_baseline", {
    rangeDays: rangeDays ?? null,
  });
}

export async function getBaseline(): Promise<BaselineEntry[]> {
  return invoke<BaselineEntry[]>("cmd_get_baseline");
}

export async function detectAnomalies(sessionId: string): Promise<Anomaly[]> {
  return invoke<Anomaly[]>("cmd_detect_anomalies", { sessionId });
}

export async function getHealthScore(hours?: number): Promise<HealthScore> {
  return invoke<HealthScore>("cmd_get_health_score", { hours: hours ?? null });
}

export async function searchSessions(
  query: string,
  limit?: number,
): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("cmd_search_sessions", {
    query,
    limit: limit ?? null,
  });
}

export async function updateSessionTags(
  sessionId: string,
  tags: string[],
): Promise<void> {
  return invoke<void>("cmd_update_session_tags", { sessionId, tags });
}
