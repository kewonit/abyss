import React, { useState, useCallback, useEffect, useRef } from "react";
import { useTelemetryStore } from "../telemetry/store";
import { useShallow } from "zustand/react/shallow";
import { formatDataRate, formatBitRate, formatNumber, countryFlag } from "../lib/utils";

const DIR_COLOR: Record<string, string> = {
  up: "bg-(--accent-orange)",
  down: "bg-(--accent-cyan)",
  bidi: "bg-(--accent-purple)",
};

const PROTO_COLOR: Record<string, string> = {
  tcp: "bg-(--accent-cyan)",
  udp: "bg-(--accent-purple)",
  https: "bg-(--accent-green)",
  http: "bg-(--accent-amber)",
  dns: "bg-(--accent-red)",
  icmp: "bg-[#64748b]",
};

const Sparkline: React.FC<{
  data: number[];
  color: string;
  height?: number;
  unit?: string;
  onHoverValue?: (val: string | null) => void;
}> = ({ data, color, height = 40, unit = "", onHoverValue }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const idx = Math.round(relX * (data.length - 1));
      const clamped = Math.max(0, Math.min(data.length - 1, idx));
      setHoverIdx(clamped);
      onHoverValue?.(`${data[clamped].toFixed(1)}${unit}`);
    },
    [data.length, data, onHoverValue, unit]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIdx(null);
    onHoverValue?.(null);
  }, [onHoverValue]);

  if (data.length < 2)
    return <div className="w-full h-9 block rounded-md bg-[rgba(var(--ui-fg),0.02)]" />;
  const max = Math.max(...data, 1);
  const w = 260;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: height - (v / max) * (height - 4) - 2,
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const fill = `0,${height} ${polyline} ${w},${height}`;
  const gradId = `sp-${color.replace("#", "")}`;

  const hoverPt = hoverIdx !== null ? pts[hoverIdx] : null;

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      className="w-full h-9 block rounded-md bg-[rgba(var(--ui-fg),0.02)] cursor-crosshair"
      preserveAspectRatio="none"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
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
      {hoverPt ? (
        <>
          <line
            x1={hoverPt.x}
            y1={0}
            x2={hoverPt.x}
            y2={height}
            stroke={color}
            strokeWidth="0.5"
            strokeOpacity="0.4"
          />
          <circle
            cx={hoverPt.x}
            cy={hoverPt.y}
            r="3"
            fill={color}
            stroke="rgba(var(--ui-bg),1)"
            strokeWidth="1"
          />
        </>
      ) : (
        pts.length > 0 && (
          <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="2.5" fill={color} />
        )
      )}
    </svg>
  );
};

export const StatsPanel: React.FC = () => {
  const isPlayback = useTelemetryStore((s) => s.playback.active);
  const { derived, frame, flows, throughputHistory, latencyHistory, connected } = useTelemetryStore(
    useShallow((s) => ({
      derived: s.derived,
      frame: s.frame,
      flows: s.flows,
      throughputHistory: s.throughputHistory,
      latencyHistory: s.latencyHistory,
      connected: s.connected,
    }))
  );

  const [stableFlows, setStableFlows] = useState(flows);
  const [stableCountries, setStableCountries] = useState(derived.topCountries);
  const [hoverThroughput, setHoverThroughput] = useState<string | null>(null);
  const [hoverLatency, setHoverLatency] = useState<string | null>(null);
  const lastNonEmptyFlowsAt = useRef(0);
  const lastNonEmptyCountriesAt = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (flows.length > 0) {
      lastNonEmptyFlowsAt.current = now;
      setStableFlows(flows);
      return;
    }
    if (now - lastNonEmptyFlowsAt.current > 2500) {
      setStableFlows([]);
    }
  }, [flows]);

  useEffect(() => {
    const now = Date.now();
    if (derived.topCountries.length > 0) {
      lastNonEmptyCountriesAt.current = now;
      setStableCountries(derived.topCountries);
      return;
    }
    if (now - lastNonEmptyCountriesAt.current > 2500) {
      setStableCountries([]);
    }
  }, [derived.topCountries]);

  // ── Shared bottom strip renderer ─────────────────────────────────
  const renderBottomStrip = (position: string, columns: string, showUpDown: boolean) => (
    <aside
      aria-label="Network statistics"
      className={`absolute ${position} left-3 right-3 z-20 h-25 overflow-hidden bg-(--pill-bg) border border-(--pill-border) rounded-(--pill-radius) backdrop-blur-xl pointer-events-auto max-[640px]:hidden shadow-[0_-2px_16px_rgba(0,0,0,0.2)]`}
    >
      <div
        className="grid gap-0 divide-x divide-[rgba(var(--ui-fg),0.06)] items-stretch h-full"
        style={{ gridTemplateColumns: columns, padding: "10px 0" }}
      >
        {/* Throughput */}
        <div className="px-3.5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Throughput
            </span>
            {hoverThroughput && (
              <span className="font-mono text-[13px] font-semibold text-(--accent-cyan) tabular-nums">
                {hoverThroughput}
              </span>
            )}
          </div>
          <Sparkline
            data={throughputHistory}
            color="#00d4f5"
            height={28}
            unit=" Mbps"
            onHoverValue={setHoverThroughput}
          />
          <div className="font-mono text-sm font-bold text-[rgba(var(--ui-fg),0.8)] tabular-nums flex items-baseline gap-1 mt-1">
            {derived.throughputMbps.toFixed(1)}
            <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.3)]">Mbps</span>
          </div>
        </div>

        {/* Upload — only in live mode */}
        {showUpDown && (
          <div className="px-3.5 flex flex-col justify-between overflow-hidden">
            <span className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)] mb-1">
              Upload
            </span>
            <div className="flex-1 flex items-center">
              <span className="font-mono text-[15px] font-semibold text-(--accent-orange) tabular-nums whitespace-nowrap">
                {frame ? formatBitRate(frame.net.uploadBps * 8) : "0 bps"}
              </span>
            </div>
          </div>
        )}

        {/* Download — only in live mode */}
        {showUpDown && (
          <div className="px-3.5 flex flex-col justify-between overflow-hidden">
            <span className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)] mb-1">
              Download
            </span>
            <div className="flex-1 flex items-center">
              <span className="font-mono text-[15px] font-semibold text-(--accent-cyan) tabular-nums whitespace-nowrap">
                {frame ? formatBitRate(frame.net.downloadBps * 8) : "0 bps"}
              </span>
            </div>
          </div>
        )}

        {/* Latency */}
        <div className="px-3.5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Latency
            </span>
            {hoverLatency && (
              <span className="font-mono text-[13px] font-semibold text-(--accent-orange) tabular-nums">
                {hoverLatency}
              </span>
            )}
          </div>
          <Sparkline
            data={latencyHistory}
            color="#ff7a45"
            height={28}
            unit="ms"
            onHoverValue={setHoverLatency}
          />
          <div className="font-mono text-sm font-bold text-[rgba(var(--ui-fg),0.8)] tabular-nums flex items-baseline gap-1 mt-1">
            {frame?.net.latencyMs.toFixed(0) ?? "0"}
            <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.3)]">ms</span>
          </div>
        </div>

        {/* Destinations */}
        <div className="px-3.5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Destinations
            </span>
            <span className="font-mono text-[13px] font-semibold text-[rgba(var(--ui-fg),0.3)] bg-[rgba(var(--ui-fg),0.04)] px-1.5 py-0.5 rounded tabular-nums">
              {formatNumber(stableCountries.length)}
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-0.5 max-h-12 overflow-y-auto [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-thumb]:bg-[rgba(var(--ui-fg),0.08)]">
            {stableCountries.length === 0 ? (
              <span className="text-[13px] text-[rgba(var(--ui-fg),0.12)]">No destinations</span>
            ) : (
              stableCountries.slice(0, 6).map((c) => (
                <div key={c.country} className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[13px] leading-none shrink-0">
                      {countryFlag(c.country)}
                    </span>
                    <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.5)] truncate">
                      {c.country}
                    </span>
                  </div>
                  <span className="font-mono text-[13px] font-semibold text-(--accent-cyan) tabular-nums shrink-0">
                    {formatDataRate(c.bps)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Active Flows */}
        <div className="px-3.5 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Active Flows
            </span>
            <span className="font-mono text-[13px] font-semibold text-[rgba(var(--ui-fg),0.3)] bg-[rgba(var(--ui-fg),0.04)] px-1.5 py-0.5 rounded tabular-nums">
              {formatNumber(stableFlows.length)}
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-0.5 max-h-12 overflow-y-auto [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-thumb]:bg-[rgba(var(--ui-fg),0.08)]">
            {stableFlows.length === 0 ? (
              <span className="text-[13px] text-[rgba(var(--ui-fg),0.12)]">No active flows</span>
            ) : (
              stableFlows.slice(0, 8).map((f) => (
                <div key={f.id} className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-1 min-w-0">
                    <span
                      className={`inline-block w-0.5 h-2.5 rounded-[1px] shrink-0 ${DIR_COLOR[f.dir] ?? "bg-(--accent-purple)"}`}
                    />
                    <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.55)] truncate">
                      {f.dst.city || f.dst.ip}
                    </span>
                  </div>
                  <span className="font-mono text-[13px] text-(--accent-cyan) tabular-nums shrink-0">
                    {formatDataRate(f.bps)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );

  // ── Playback mode ──
  if (isPlayback) {
    return renderBottomStrip("bottom-30.5", "2fr 2fr 3fr 3fr", false);
  }

  // ── Live mode ──
  return renderBottomStrip("bottom-4", "2fr 1.2fr 1.2fr 2fr 2.5fr 2.5fr", true);
};
