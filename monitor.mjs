import { WebSocketServer } from "ws";
import { execSync } from "child_process";

const PORT = 9770;
const TICK_INTERVAL_MS = 1000;
const NETSTAT_POLL_MS = 2000;
const GEO_API = "http://ip-api.com/batch";
const MAX_FLOWS_PER_FRAME = 35;
const GEO_CACHE = new Map();
const MAX_GEO_CACHE_SIZE = 5000;
const GEO_CACHE_TTL_MS = 30 * 60 * 1000;
const SCHEMA_VERSION = 2;
const VERBOSE = process.env.ABYSS_MONITOR_VERBOSE === "1";
const PERF_LOG_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 5000;
const MATERIAL_FLOW_DELTA = 3;
const MATERIAL_THROUGHPUT_DELTA_PCT = 12;
const MATERIAL_MIN_BPS_DELTA = 900_000;
const MATERIAL_LATENCY_DELTA_MS = 15;
const GEO_BACKOFF_MIN_MS = 3000;
const GEO_BACKOFF_MAX_MS = 30000;
const MAX_WS_BUFFERED_BYTES = 1_000_000;
const MAX_WS_DROPPED_SENDS = 5;

let lastSnapshot = null;
let lastHeartbeatAt = Date.now() - HEARTBEAT_INTERVAL_MS;

const perf = {
  parseNetstatMs: 0,
  geolocateBatchMs: 0,
  buildFrameMs: 0,
  emitFrameMs: 0,
  wsPayloadBytes: 0,
  cycles: 0,
  ticks: 0,
  geoCacheHits: 0,
  geoCacheMisses: 0,
  lastLogAt: Date.now(),
};

function getGeoCache(ip) {
  const entry = GEO_CACHE.get(ip);
  if (!entry) {
    perf.geoCacheMisses += 1;
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    GEO_CACHE.delete(ip);
    perf.geoCacheMisses += 1;
    return undefined;
  }
  entry.lastAccessAt = Date.now();
  perf.geoCacheHits += 1;
  return entry.value;
}

function setGeoCache(ip, value) {
  GEO_CACHE.set(ip, {
    value,
    expiresAt: Date.now() + GEO_CACHE_TTL_MS,
    lastAccessAt: Date.now(),
  });
}

function pruneGeoCache() {
  const now = Date.now();
  for (const [key, entry] of GEO_CACHE) {
    if (entry.expiresAt <= now) GEO_CACHE.delete(key);
  }

  if (GEO_CACHE.size <= MAX_GEO_CACHE_SIZE) return;
  const sorted = [...GEO_CACHE.entries()].sort(
    (a, b) => a[1].lastAccessAt - b[1].lastAccessAt,
  );
  const removeCount = GEO_CACHE.size - MAX_GEO_CACHE_SIZE;
  for (let i = 0; i < removeCount; i++) {
    GEO_CACHE.delete(sorted[i][0]);
  }
}

function maybeLogPerf() {
  const now = Date.now();
  if (
    !VERBOSE ||
    now - perf.lastLogAt < PERF_LOG_INTERVAL_MS ||
    perf.cycles === 0
  ) {
    return;
  }

  const cycleDenom = perf.cycles;
  const emitDenom = Math.max(1, perf.ticks);
  const avgParse = (perf.parseNetstatMs / cycleDenom).toFixed(1);
  const avgGeo = (perf.geolocateBatchMs / cycleDenom).toFixed(1);
  const avgBuild = (perf.buildFrameMs / cycleDenom).toFixed(1);
  const avgEmit = (perf.emitFrameMs / emitDenom).toFixed(1);
  const avgPayloadKb = (perf.wsPayloadBytes / emitDenom / 1024).toFixed(1);
  const hitRate =
    perf.geoCacheHits + perf.geoCacheMisses > 0
      ? (
          (perf.geoCacheHits * 100) /
          (perf.geoCacheHits + perf.geoCacheMisses)
        ).toFixed(1)
      : "0.0";

  console.log(
    `\n📊 perf avg parse=${avgParse}ms geo=${avgGeo}ms build=${avgBuild}ms emit=${avgEmit}ms payload=${avgPayloadKb}KB hit=${hitRate}% cache=${GEO_CACHE.size}`,
  );

  perf.parseNetstatMs = 0;
  perf.geolocateBatchMs = 0;
  perf.buildFrameMs = 0;
  perf.emitFrameMs = 0;
  perf.wsPayloadBytes = 0;
  perf.cycles = 0;
  perf.ticks = 0;
  perf.geoCacheHits = 0;
  perf.geoCacheMisses = 0;
  perf.lastLogAt = now;
}

function isMaterialChange(frame) {
  if (!lastSnapshot) return true;

  const flowDelta = Math.abs(lastSnapshot.activeFlows - frame.net.activeFlows);
  if (flowDelta >= MATERIAL_FLOW_DELTA) return true;

  const baseBps = Math.max(1, lastSnapshot.bps);
  const throughputAbsDelta = Math.abs(frame.net.bps - lastSnapshot.bps);
  const throughputDeltaPct = (throughputAbsDelta / baseBps) * 100;
  if (
    throughputAbsDelta >= MATERIAL_MIN_BPS_DELTA &&
    throughputDeltaPct >= MATERIAL_THROUGHPUT_DELTA_PCT
  ) {
    return true;
  }

  return (
    Math.abs(frame.net.latencyMs - lastSnapshot.latencyMs) >=
    MATERIAL_LATENCY_DELTA_MS
  );
}

function isPrivateIP(ip) {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.20.") ||
    ip.startsWith("172.21.") ||
    ip.startsWith("172.22.") ||
    ip.startsWith("172.23.") ||
    ip.startsWith("172.24.") ||
    ip.startsWith("172.25.") ||
    ip.startsWith("172.26.") ||
    ip.startsWith("172.27.") ||
    ip.startsWith("172.28.") ||
    ip.startsWith("172.29.") ||
    ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip.startsWith("127.") ||
    ip.startsWith("0.") ||
    ip === "::1" ||
    ip.startsWith("fe80:") ||
    ip.startsWith("fc00:") ||
    ip.startsWith("fd") ||
    ip === "*"
  );
}

function parseNetstat() {
  try {
    const raw = execSync("netstat -no", {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    const lines = raw.split("\n").filter((l) => l.trim());
    const connections = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      const proto = parts[0].toUpperCase();
      if (proto !== "TCP" && proto !== "UDP") continue;

      const local = parts[1];
      const foreign = parts[2];
      const state = proto === "TCP" ? parts[3] : "STATELESS";
      const pid = parseInt(parts[proto === "TCP" ? 4 : 3], 10) || 0;

      const localParts = splitAddress(local);
      const foreignParts = splitAddress(foreign);

      if (
        !foreignParts ||
        foreignParts.ip === "*" ||
        foreignParts.ip === "0.0.0.0"
      )
        continue;
      if (isPrivateIP(foreignParts.ip)) continue;

      connections.push({
        proto: proto.toLowerCase(),
        localIP: localParts?.ip || "0.0.0.0",
        localPort: localParts?.port || 0,
        remoteIP: foreignParts.ip,
        remotePort: foreignParts.port,
        state,
        pid,
      });
    }

    return connections;
  } catch (e) {
    console.error("netstat failed:", e.message);
    return [];
  }
}

function splitAddress(addr) {
  if (!addr) return null;
  if (addr.startsWith("[")) {
    const closeBracket = addr.indexOf("]");
    if (closeBracket < 0) return null;
    const portPart = addr.slice(closeBracket + 2);
    return {
      ip: addr.slice(1, closeBracket),
      port: parseInt(portPart, 10) || 0,
    };
  }
  const lastColon = addr.lastIndexOf(":");
  if (lastColon <= 0) return { ip: addr, port: 0 };
  const ip = addr.slice(0, lastColon);
  const portPart = addr.slice(lastColon + 1);
  if (!ip) return null;
  return {
    ip,
    port: parseInt(portPart, 10) || 0,
  };
}

async function geolocateBatch(ips) {
  const uncached = ips.filter(
    (ip) => getGeoCache(ip) === undefined && !isPrivateIP(ip),
  );
  if (uncached.length === 0) return true;

  const batch = uncached.slice(0, 100);
  try {
    const resp = await fetch(GEO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        batch.map((ip) => ({
          query: ip,
          fields: "status,lat,lon,city,country,countryCode,isp",
        })),
      ),
    });

    if (!resp.ok) return false;
    const results = await resp.json();
    if (!Array.isArray(results)) return false;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "success") {
        setGeoCache(batch[i], {
          lat: r.lat,
          lng: r.lon,
          city: r.city || "Unknown",
          country: r.countryCode || r.country || "??",
          isp: r.isp,
        });
      } else {
        setGeoCache(batch[i], null);
      }
    }
    pruneGeoCache();
    return true;
  } catch (e) {
    console.error("GeoIP batch failed:", e.message);
    return false;
  }
}

const PORT_SERVICES = {
  21: "FTP",
  22: "SSH",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  110: "POP3",
  143: "IMAP",
  443: "HTTPS",
  465: "SMTPS",
  587: "SMTP",
  993: "IMAPS",
  995: "POP3S",
  1433: "MSSQL",
  3306: "MySQL",
  3389: "RDP",
  5432: "Postgres",
  5900: "VNC",
  6379: "Redis",
  8080: "HTTP-Alt",
  8443: "HTTPS-Alt",
  27017: "MongoDB",
  9090: "Prometheus",
};

function getService(port) {
  return PORT_SERVICES[port] || null;
}

let prevConnections = new Map();
let startTime = Date.now();
let cachedConnections = [];
let lastNetstatAt = 0;
let lastGeoLookupAt = 0;
let geoTask = null;
let geoTaskStartedAt = 0;
let geoFailureCount = 0;
let geoBackoffUntil = 0;
const FLOW_GRACE_MS = 8000;
const flowPresence = new Map();
const flowFirstSeen = new Map();
let processNames = new Map();
let lastProcessRefresh = 0;
const PROCESS_CACHE_TTL_MS = 10_000;

function refreshProcessCache() {
  try {
    const raw = execSync("tasklist /FO CSV /NH", {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    const map = new Map();
    for (const line of raw.split("\n")) {
      const match = line.match(/"([^"]+)","(\d+)"/);
      if (match) {
        const pid = parseInt(match[2], 10);
        if (pid > 0) map.set(pid, match[1]);
      }
    }
    processNames = map;
    lastProcessRefresh = Date.now();
  } catch {
    // keep previous cache on failure
  }
}

function fnv1aHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildFrame(connections) {
  const now = (Date.now() - startTime) / 1000;
  const round2 = (value) => Math.round(value * 100) / 100;

  const flowMap = new Map();
  for (const conn of connections) {
    const key = `${conn.remoteIP}:${conn.remotePort}:${conn.proto}`;
    if (!flowMap.has(key)) {
      flowMap.set(key, conn);
    }
  }

  const flows = [];
  const protoCounts = {
    tcp: 0,
    udp: 0,
    icmp: 0,
    dns: 0,
    https: 0,
    http: 0,
    other: 0,
  };
  let totalUpBps = 0;
  let totalDownBps = 0;

  for (const [key, conn] of flowMap) {
    const geo = getGeoCache(conn.remoteIP);
    if (!geo) continue;

    const isUpload = conn.state === "ESTABLISHED" || conn.state === "STATELESS";
    const baseBps =
      conn.remotePort === 443
        ? 50000
        : conn.remotePort === 80
          ? 30000
          : conn.remotePort === 53
            ? 500
            : conn.remotePort === 22
              ? 5000
              : 10000;

    const existed = prevConnections.has(key);
    const keyHash = fnv1aHash(key);
    const bpsFactor = existed ? 0.7 + (keyHash % 60) / 100 : 2;
    const estimatedBps = baseBps * bpsFactor;

    const dir = isUpload ? (keyHash % 2 === 0 ? "up" : "down") : "bidi";

    if (!flowFirstSeen.has(key)) flowFirstSeen.set(key, now);
    const firstSeen = flowFirstSeen.get(key);

    const procName = conn.pid > 0 ? processNames.get(conn.pid) || null : null;

    flows.push({
      id: `live-${key}`,
      src: {
        ip: conn.localIP,
        lat: 0,
        lng: 0,
        city: "Local",
        country: "Local",
      },
      dst: {
        ip: conn.remoteIP,
        lat: round2(geo.lat),
        lng: round2(geo.lng),
        city: geo.city,
        country: geo.country,
      },
      bps: Math.round(estimatedBps / 10) * 10,
      pps: Math.max(1, (estimatedBps / 1000) | 0),
      rtt: round2(10 + (keyHash % 600) / 10),
      protocol: conn.proto,
      dir,
      port: conn.remotePort,
      service: getService(conn.remotePort),
      startedAt: firstSeen,
      process: procName,
      pid: conn.pid > 0 ? conn.pid : undefined,
    });

    if (conn.remotePort === 443) protoCounts.https++;
    else if (conn.remotePort === 80) protoCounts.http++;
    else if (conn.remotePort === 53) protoCounts.dns++;

    if (conn.proto === "tcp") protoCounts.tcp++;
    else if (conn.proto === "udp") protoCounts.udp++;
    else protoCounts.other++;

    if (dir === "up") totalUpBps += estimatedBps;
    else totalDownBps += estimatedBps;
  }

  prevConnections = flowMap;

  for (const k of flowFirstSeen.keys()) {
    if (!flowMap.has(k)) flowFirstSeen.delete(k);
  }

  const totalBps = totalUpBps + totalDownBps;
  const avgRtt =
    flows.length > 0 ? flows.reduce((s, f) => s + f.rtt, 0) / flows.length : 0;

  return {
    schema: SCHEMA_VERSION,
    t: now,
    net: {
      bps: totalBps,
      pps: flows.reduce((s, f) => s + f.pps, 0),
      activeFlows: flows.length,
      latencyMs: avgRtt,
      uploadBps: totalUpBps,
      downloadBps: totalDownBps,
    },
    proto: protoCounts,
    flows: flows.slice(0, MAX_FLOWS_PER_FRAME),
  };
}

async function detectLocalGeo() {
  try {
    const resp = await fetch(
      "http://ip-api.com/json/?fields=lat,lon,city,countryCode",
    );
    if (resp.ok) {
      const data = await resp.json();
      if (
        typeof data.lat === "number" &&
        typeof data.lon === "number" &&
        Number.isFinite(data.lat) &&
        Number.isFinite(data.lon)
      ) {
        return {
          lat: data.lat,
          lng: data.lon,
          city: data.city || "Unknown",
          country: data.countryCode || "XX",
        };
      }
    }
  } catch {}
  return { lat: 40.71, lng: -74.01, city: "New York", country: "US" };
}

async function main() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   ABYSS Live Monitor v1.0              ║");
  console.log("║   WebSocket: ws://127.0.0.1:" + PORT + "       ║");
  console.log("╚════════════════════════════════════════╝");
  console.log();

  const localGeo = await detectLocalGeo();
  console.log(
    `📍 Local: ${localGeo.city}, ${localGeo.country} (${localGeo.lat.toFixed(2)}, ${localGeo.lng.toFixed(2)})`,
  );

  const wss = new WebSocketServer({ port: PORT });
  console.log(`🌐 WebSocket server listening on port ${PORT}`);

  const clients = new Set();
  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`✅ Client connected (${clients.size} total)`);
    ws.on("close", () => {
      clients.delete(ws);
      console.log(`❌ Client disconnected (${clients.size} total)`);
    });
    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  let running = true;
  const stop = () => {
    running = false;
    for (const ws of clients) {
      try {
        ws.close();
      } catch {}
    }
    wss.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    perf.cycles += 1;
    let connections = cachedConnections;
    if (Date.now() - lastNetstatAt >= NETSTAT_POLL_MS) {
      const parseStart = performance.now();
      connections = parseNetstat();
      perf.parseNetstatMs += performance.now() - parseStart;
      cachedConnections = connections;
      lastNetstatAt = Date.now();
    }

    const remoteIPs = [...new Set(connections.map((c) => c.remoteIP))];

    const presenceNow = Date.now();
    for (const conn of connections) {
      const key = `${conn.remoteIP}:${conn.remotePort}:${conn.proto}`;
      flowPresence.set(key, { conn, lastSeen: presenceNow });
    }
    const presenceCutoff = presenceNow - FLOW_GRACE_MS;
    for (const [key, entry] of flowPresence) {
      if (entry.lastSeen < presenceCutoff) flowPresence.delete(key);
    }
    const stableConnections = [...flowPresence.values()].map((e) => e.conn);

    if (
      !geoTask &&
      Date.now() >= geoBackoffUntil &&
      Date.now() - lastGeoLookupAt >= 3000
    ) {
      geoTaskStartedAt = performance.now();
      geoTask = geolocateBatch(remoteIPs)
        .then((ok) => {
          if (ok) {
            geoFailureCount = 0;
            return;
          }
          geoFailureCount += 1;
          const backoffMs = Math.min(
            GEO_BACKOFF_MAX_MS,
            GEO_BACKOFF_MIN_MS * 2 ** Math.min(5, geoFailureCount - 1),
          );
          geoBackoffUntil = Date.now() + backoffMs;
        })
        .catch(() => {
          geoFailureCount += 1;
          const backoffMs = Math.min(
            GEO_BACKOFF_MAX_MS,
            GEO_BACKOFF_MIN_MS * 2 ** Math.min(5, geoFailureCount - 1),
          );
          geoBackoffUntil = Date.now() + backoffMs;
        })
        .finally(() => {
          perf.geolocateBatchMs += performance.now() - geoTaskStartedAt;
          geoTask = null;
        });
      lastGeoLookupAt = Date.now();
    }

    if (Date.now() - lastProcessRefresh >= PROCESS_CACHE_TTL_MS) {
      refreshProcessCache();
    }

    const buildStart = performance.now();
    const frame = buildFrame(stableConnections);
    perf.buildFrameMs += performance.now() - buildStart;

    for (const flow of frame.flows) {
      flow.src.lat = localGeo.lat;
      flow.src.lng = localGeo.lng;
      flow.src.city = localGeo.city;
      flow.src.country = localGeo.country;
    }

    if (clients.size > 0) {
      const material = isMaterialChange(frame);
      const shouldEmitHeartbeat =
        !material && Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS;

      let emitFrame = null;
      if (material) {
        emitFrame = frame;
        lastSnapshot = {
          activeFlows: frame.net.activeFlows,
          bps: frame.net.bps,
          latencyMs: frame.net.latencyMs,
        };
      } else if (shouldEmitHeartbeat) {
        emitFrame = {
          ...frame,
          light: true,
          flows: [],
        };
        lastHeartbeatAt = Date.now();
      }

      if (!emitFrame) {
        perf.ticks += 1;
        maybeLogPerf();
        await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
        continue;
      }

      const emitStart = performance.now();
      const json = JSON.stringify(emitFrame);
      perf.wsPayloadBytes += Buffer.byteLength(json);
      for (const ws of clients) {
        try {
          if (ws.readyState !== ws.OPEN) {
            clients.delete(ws);
            continue;
          }
          const dropped = Number(ws.__abyssDropCount || 0);
          if (ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
            ws.__abyssDropCount = dropped + 1;
            if (ws.__abyssDropCount >= MAX_WS_DROPPED_SENDS) {
              ws.close();
              clients.delete(ws);
            }
            continue;
          }
          ws.__abyssDropCount = 0;
          ws.send(json);
        } catch {
          clients.delete(ws);
        }
      }
      perf.emitFrameMs += performance.now() - emitStart;
    }

    if (VERBOSE) {
      const flowCount = frame.flows.length;
      const totalMbps = ((frame.net.bps * 8) / 1_000_000).toFixed(1);
      process.stdout.write(
        `\r🔄 ${flowCount} flows | ${totalMbps} Mbps | ${remoteIPs.length} IPs | ${GEO_CACHE.size} geo cached`,
      );
    }

    perf.ticks += 1;
    maybeLogPerf();

    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }
}

main().catch(console.error);
