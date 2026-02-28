interface GeoEndpoint {
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

interface ProtoCounters {
  tcp: number;
  udp: number;
  icmp: number;
  dns: number;
  https: number;
  http: number;
  other: number;
}

interface NetMetrics {
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

// Pre-allocated reusable buffers for computeDerivedMetrics — avoids creating
// ~7 intermediate arrays per frame (420 short-lived arrays/sec at 60fps).
const _countryEntries: Array<{ country: string; bps: number }> = [];
const _countryMap = new Map<string, number>();
const _protoPool: Array<{ protocol: string; count: number }> = [
  { protocol: "TCP", count: 0 },
  { protocol: "UDP", count: 0 },
  { protocol: "HTTPS", count: 0 },
  { protocol: "HTTP", count: 0 },
  { protocol: "DNS", count: 0 },
  { protocol: "ICMP", count: 0 },
];

export function computeDerivedMetrics(frame: TelemetryFrame): DerivedMetrics {
  const throughputMbps = (frame.net.bps * 8) / 1_000_000;
  const uploadMbps = (frame.net.uploadBps * 8) / 1_000_000;
  const downloadMbps = (frame.net.downloadBps * 8) / 1_000_000;

  const normThroughput = Math.min(throughputMbps / 100, 1);
  const normLatency = Math.min(frame.net.latencyMs / 200, 1);
  const networkPressure = Math.min(1, normThroughput * 0.6 + normLatency * 0.4);

  _countryMap.clear();
  for (const flow of frame.flows) {
    const country = flow.dst.country || "Unknown";
    _countryMap.set(country, (_countryMap.get(country) || 0) + flow.bps);
  }
  _countryEntries.length = 0;
  for (const [country, bps] of _countryMap) {
    _countryEntries.push({ country, bps });
  }
  _countryEntries.sort((a, b) => b.bps - a.bps);
  // .slice() creates a new array for Zustand immutability
  const topCountries = _countryEntries.slice(0, 5);

  _protoPool[0].count = frame.proto.tcp;
  _protoPool[1].count = frame.proto.udp;
  _protoPool[2].count = frame.proto.https;
  _protoPool[3].count = frame.proto.http;
  _protoPool[4].count = frame.proto.dns;
  _protoPool[5].count = frame.proto.icmp;
  const topProtocols: Array<{ protocol: string; count: number }> = [];
  for (const p of _protoPool) {
    if (p.count > 0)
      topProtocols.push({ protocol: p.protocol, count: p.count });
  }
  topProtocols.sort((a, b) => b.count - a.count);

  return {
    throughputMbps,
    uploadMbps,
    downloadMbps,
    networkPressure,
    topCountries,
    topProtocols,
  };
}
