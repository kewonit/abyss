export const SCHEMA_VERSION = 2;

export interface GeoEndpoint {
  ip: string;
  lat: number;
  lng: number;
  city?: string;
  country?: string;
}

export interface GeoFlow {
  id: string;
  src: GeoEndpoint;
  dst: GeoEndpoint;
  bps: number;
  pps: number;
  rtt: number;
  protocol: string;
  dir: "up" | "down" | "bidi";
  port: number;
  service?: string;
  startedAt: number;
}

export interface ProtoCounters {
  tcp: number;
  udp: number;
  icmp: number;
  dns: number;
  https: number;
  http: number;
  other: number;
}

export interface NetMetrics {
  bps: number;
  pps: number;
  activeFlows: number;
  latencyMs: number;
  uploadBps: number;
  downloadBps: number;
}

export interface TelemetryFrame {
  schema: number;
  t: number;
  net: NetMetrics;
  proto: ProtoCounters;
  flows: GeoFlow[];
}

export interface DerivedMetrics {
  throughputMbps: number;
  uploadMbps: number;
  downloadMbps: number;
  networkPressure: number;
  topCountries: Array<{ country: string; bps: number }>;
  topProtocols: Array<{ protocol: string; count: number }>;
}

export function computeDerivedMetrics(frame: TelemetryFrame): DerivedMetrics {
  const throughputMbps = (frame.net.bps * 8) / 1_000_000;
  const uploadMbps = (frame.net.uploadBps * 8) / 1_000_000;
  const downloadMbps = (frame.net.downloadBps * 8) / 1_000_000;

  const normThroughput = Math.min(throughputMbps / 100, 1);
  const normLatency = Math.min(frame.net.latencyMs / 200, 1);
  const networkPressure = Math.min(1, normThroughput * 0.6 + normLatency * 0.4);

  const countryMap = new Map<string, number>();
  for (const flow of frame.flows) {
    const country = flow.dst.country || "Unknown";
    countryMap.set(country, (countryMap.get(country) || 0) + flow.bps);
  }
  const topCountries = Array.from(countryMap.entries())
    .map(([country, bps]) => ({ country, bps }))
    .sort((a, b) => b.bps - a.bps)
    .slice(0, 5);

  const topProtocols: Array<{ protocol: string; count: number }> = [
    { protocol: "TCP", count: frame.proto.tcp },
    { protocol: "UDP", count: frame.proto.udp },
    { protocol: "HTTPS", count: frame.proto.https },
    { protocol: "HTTP", count: frame.proto.http },
    { protocol: "DNS", count: frame.proto.dns },
    { protocol: "ICMP", count: frame.proto.icmp },
  ]
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    throughputMbps,
    uploadMbps,
    downloadMbps,
    networkPressure,
    topCountries,
    topProtocols,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateFrame(data: unknown): TelemetryFrame | null {
  if (!isRecord(data)) return null;

  const schema = data.schema;
  const t = data.t;
  const net = data.net;
  const proto = data.proto;
  const flows = data.flows;

  if (!isFiniteNumber(schema) || schema < 1) return null;
  if (!isFiniteNumber(t) || t < 0) return null;
  if (!isRecord(net) || !isRecord(proto) || !Array.isArray(flows)) return null;

  const requiredNetKeys = [
    "bps",
    "pps",
    "activeFlows",
    "latencyMs",
    "uploadBps",
    "downloadBps",
  ] as const;
  for (const key of requiredNetKeys) {
    if (!isFiniteNumber(net[key]) || (net[key] as number) < 0) return null;
  }

  return data as unknown as TelemetryFrame;
}
