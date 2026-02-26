import React from "react";
import { useTelemetryStore } from "../telemetry/store";

function countryFlag(code: string): string {
  if (!code || code.length < 2 || code === "Local") return "🌐";
  const upper = code.toUpperCase().slice(0, 2);
  try {
    return String.fromCodePoint(
      ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
    );
  } catch {
    return "🌐";
  }
}

function formatBytes(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} GB/s`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

const Sparkline: React.FC<{
  data: number[];
  color: string;
  height?: number;
}> = ({ data, color, height = 40 }) => {
  if (data.length < 2) return <div className="sparkline-svg" />;
  const max = Math.max(...data, 1);
  const w = 260;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: height - (v / max) * (height - 4) - 2,
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const fill = `0,${height} ${polyline} ${w},${height}`;
  const gradId = `sp-${color.replace("#", "")}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      className="sparkline-svg"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={fill} fill={`url(#${gradId})`} />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.length > 0 && (
        <circle
          cx={pts[pts.length - 1].x}
          cy={pts[pts.length - 1].y}
          r="2.5"
          fill={color}
        />
      )}
    </svg>
  );
};

export const StatsPanel: React.FC = () => {
  const derived = useTelemetryStore((s) => s.derived);
  const frame = useTelemetryStore((s) => s.frame);
  const flows = useTelemetryStore((s) => s.flows);
  const throughputHistory = useTelemetryStore((s) => s.throughputHistory);
  const latencyHistory = useTelemetryStore((s) => s.latencyHistory);
  const connected = useTelemetryStore((s) => s.connected);

  return (
    <aside className="stats-panel">
      <section className="stats-section status-section">
        <div className="status-row">
          <span className={`status-dot ${connected ? "live" : "off"}`} />
          <span className="status-text">{connected ? "Live" : "Offline"}</span>
          <span className="status-divider" />
          <span className="status-flows">
            {frame ? frame.net.activeFlows : 0} flows
          </span>
        </div>
      </section>

      <section className="stats-section">
        <div className="section-header">
          <span className="section-title">Throughput</span>
        </div>
        <div className="chart-container">
          <Sparkline data={throughputHistory} color="#00d4f5" />
        </div>
        <div className="chart-value">
          {derived.throughputMbps.toFixed(1)}
          <span className="chart-unit">Mbps</span>
        </div>
      </section>

      <section className="stats-section">
        <div className="section-header">
          <span className="section-title">Latency</span>
        </div>
        <div className="chart-container">
          <Sparkline data={latencyHistory} color="#ff7a45" height={32} />
        </div>
        <div className="chart-value">
          {frame?.net.latencyMs.toFixed(0) ?? "—"}
          <span className="chart-unit">ms</span>
        </div>
      </section>

      <section className="stats-section">
        <div className="section-header">
          <span className="section-title">Protocols</span>
        </div>
        <div className="proto-list">
          {derived.topProtocols.map((p) => {
            const total =
              derived.topProtocols.reduce((s, x) => s + x.count, 0) || 1;
            const pct = (p.count / total) * 100;
            const cls = p.protocol.toLowerCase().replace(/[^a-z]/g, "");
            return (
              <div key={p.protocol} className="proto-item">
                <span className="proto-label">{p.protocol}</span>
                <div className="proto-track">
                  <div
                    className={`proto-fill ${cls}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="proto-count">{p.count}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="stats-section">
        <div className="section-header">
          <span className="section-title">Destinations</span>
          <span className="section-badge">{derived.topCountries.length}</span>
        </div>
        <div className="dest-list">
          {derived.topCountries.map((c) => (
            <div key={c.country} className="dest-item">
              <div className="dest-info">
                <span className="dest-flag">{countryFlag(c.country)}</span>
                <span className="dest-name">{c.country}</span>
              </div>
              <span className="dest-traffic">{formatBytes(c.bps)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stats-section flow-section">
        <div className="section-header">
          <span className="section-title">Active Flows</span>
          <span className="section-badge">{flows.length}</span>
        </div>
        <div className="flow-scroll">
          <table className="flow-table">
            <thead>
              <tr>
                <th>Destination</th>
                <th>Svc</th>
                <th>BW</th>
                <th>RTT</th>
              </tr>
            </thead>
            <tbody>
              {flows.slice(0, 20).map((f) => (
                <tr key={f.id} className="flow-row">
                  <td>
                    <span className={`flow-dir-indicator ${f.dir}`} />
                    <span className="flow-dst-text">
                      {f.dst.city || f.dst.ip}
                    </span>
                  </td>
                  <td className="flow-svc">{f.service || f.port}</td>
                  <td className="flow-bw">{formatBytes(f.bps)}</td>
                  <td className="flow-rtt">{f.rtt.toFixed(0)}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </aside>
  );
};
