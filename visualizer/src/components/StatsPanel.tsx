import React, { useState, useCallback, useEffect, useRef } from "react";
import { useTelemetryStore } from "../telemetry/store";
import { useShallow } from "zustand/react/shallow";
import { formatDataRate, formatNumber, countryFlag } from "../lib/utils";
import { ScrollArea } from "./ui/scroll-area";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

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
}> = ({ data, color, height = 40, unit = "" }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const idx = Math.round(relX * (data.length - 1));
      setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
    },
    [data.length],
  );

  const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

  if (data.length < 2)
    return (
      <div className="w-full h-9 block rounded-md bg-[rgba(var(--ui-fg),0.02)]" />
    );
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
  const hoverVal = hoverIdx !== null ? data[hoverIdx] : null;

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
          {/* Crosshair line */}
          <line
            x1={hoverPt.x}
            y1={0}
            x2={hoverPt.x}
            y2={height}
            stroke={color}
            strokeWidth="0.5"
            strokeOpacity="0.4"
          />
          {/* Hover dot */}
          <circle
            cx={hoverPt.x}
            cy={hoverPt.y}
            r="3"
            fill={color}
            stroke="rgba(var(--ui-bg),1)"
            strokeWidth="1"
          />
          {/* Value label */}
          <text
            x={hoverPt.x < w / 2 ? hoverPt.x + 6 : hoverPt.x - 6}
            y={8}
            textAnchor={hoverPt.x < w / 2 ? "start" : "end"}
            fill={color}
            fontSize="9"
            fontFamily="monospace"
            fontWeight="600"
          >
            {hoverVal !== null ? `${hoverVal.toFixed(1)}${unit}` : ""}
          </text>
        </>
      ) : (
        pts.length > 0 && (
          <circle
            cx={pts[pts.length - 1].x}
            cy={pts[pts.length - 1].y}
            r="2.5"
            fill={color}
          />
        )
      )}
    </svg>
  );
};

export const StatsPanel: React.FC = () => {
  const {
    derived,
    frame,
    flows,
    throughputHistory,
    latencyHistory,
    connected,
  } = useTelemetryStore(
    useShallow((s) => ({
      derived: s.derived,
      frame: s.frame,
      flows: s.flows,
      throughputHistory: s.throughputHistory,
      latencyHistory: s.latencyHistory,
      connected: s.connected,
    })),
  );

  const [stableFlows, setStableFlows] = useState(flows);
  const [stableCountries, setStableCountries] = useState(derived.topCountries);
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

  return (
    <aside
      aria-label="Network statistics"
      className="absolute top-4 right-4 bottom-4 w-72 bg-(--pill-bg) border border-(--pill-border) rounded-(--pill-radius) backdrop-blur-xl flex flex-col overflow-hidden pointer-events-auto max-[900px]:w-60 max-[640px]:hidden"
    >
      <ScrollArea className="flex-1">
        <section
          style={{ padding: "14px 18px" }}
          className="border-b border-[rgba(var(--ui-fg),0.04)]"
        >
          <div className="flex items-center gap-2.5">
            <Badge
              variant={connected ? "success" : "destructive"}
              className="text-[10px] px-2.5 py-0.5 rounded-full"
            >
              {connected ? "Live" : "Offline"}
            </Badge>
            <Separator orientation="vertical" className="h-3.5" />
            <span className="text-[12px] font-medium text-[rgba(var(--ui-fg),0.5)] tabular-nums">
              {frame ? formatNumber(frame.net.activeFlows) : 0} flows
            </span>
          </div>
        </section>

        <section
          style={{ padding: "14px 16px" }}
          className="border-b border-[rgba(var(--ui-fg),0.04)]"
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Throughput
            </span>
          </div>
          <div className="mb-1.5">
            <Sparkline data={throughputHistory} color="#00d4f5" unit=" Mbps" />
          </div>
          <div className="font-mono text-lg font-bold text-[rgba(var(--ui-fg),0.8)] tabular-nums flex items-baseline gap-1">
            {derived.throughputMbps.toFixed(1)}
            <span className="text-[11px] font-medium text-[rgba(var(--ui-fg),0.3)]">
              Mbps
            </span>
          </div>
        </section>

        <section
          style={{ padding: "14px 16px" }}
          className="border-b border-[rgba(var(--ui-fg),0.04)]"
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Latency
            </span>
          </div>
          <div className="mb-1.5">
            <Sparkline
              data={latencyHistory}
              color="#ff7a45"
              height={32}
              unit="ms"
            />
          </div>
          <div className="font-mono text-lg font-bold text-[rgba(var(--ui-fg),0.8)] tabular-nums flex items-baseline gap-1">
            {frame?.net.latencyMs.toFixed(0) ?? "—"}
            <span className="text-[11px] font-medium text-[rgba(var(--ui-fg),0.3)]">
              ms
            </span>
          </div>
        </section>

        <section
          style={{ padding: "14px 16px" }}
          className="border-b border-[rgba(var(--ui-fg),0.04)]"
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Protocols
            </span>
          </div>
          <div className="flex flex-col gap-1.25">
            {derived.topProtocols.length === 0 ? (
              <span className="text-[10px] text-[rgba(var(--ui-fg),0.2)] italic py-2">
                No protocol data
              </span>
            ) : (
              derived.topProtocols.map((p) => {
                const total =
                  derived.topProtocols.reduce((s, x) => s + x.count, 0) || 1;
                const pct = (p.count / total) * 100;
                const cls = p.protocol.toLowerCase().replace(/[^a-z]/g, "");
                const fillColor = PROTO_COLOR[cls] ?? "bg-[#475569]";
                return (
                  <Tooltip key={p.protocol}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 cursor-default">
                        <span className="w-11.5 font-mono text-[10px] font-medium text-[rgba(var(--ui-fg),0.4)] text-right">
                          {p.protocol}
                        </span>
                        <div className="flex-1 h-1.25 bg-[rgba(var(--ui-fg),0.04)] rounded-[3px] overflow-hidden">
                          <div
                            className={`h-full rounded-[3px] transition-[width] duration-400 ease-in-out ${fillColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-7 font-mono text-[10px] font-medium text-[rgba(var(--ui-fg),0.3)] text-right tabular-nums">
                          {p.count}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="left"
                      className="text-[10px] font-mono"
                    >
                      {p.protocol}: {p.count} flows · {pct.toFixed(1)}%
                    </TooltipContent>
                  </Tooltip>
                );
              })
            )}
          </div>
        </section>

        <section
          style={{ padding: "14px 16px" }}
          className="border-b border-[rgba(var(--ui-fg),0.04)]"
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Destinations
            </span>
            <span className="font-mono text-[10px] font-semibold text-[rgba(var(--ui-fg),0.35)] bg-[rgba(var(--ui-fg),0.04)] pl-1.75 pr-1.75 pt-0.5 pb-0.5 rounded-md">
              {formatNumber(stableCountries.length)}
            </span>
          </div>
          <div className="flex flex-col gap-px">
            {stableCountries.length === 0 ? (
              <span className="text-[10px] text-[rgba(var(--ui-fg),0.2)] italic py-2">
                No destinations yet
              </span>
            ) : (
              stableCountries.map((c) => (
                <div
                  key={c.country}
                  className="flex justify-between items-center pt-1 pb-1 pl-1.5 pr-1.5 rounded-md transition-[background] duration-150 hover:bg-[rgba(var(--ui-fg),0.03)]"
                >
                  <div className="flex items-center gap-1.75">
                    <span className="text-[13px] leading-none">
                      {countryFlag(c.country)}
                    </span>
                    <span className="text-[11px] font-medium text-[rgba(var(--ui-fg),0.5)]">
                      {c.country}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] font-semibold text-(--accent-cyan) tabular-nums">
                    {formatDataRate(c.bps)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section
          style={{ padding: "14px 16px" }}
          className="border-b border-[rgba(var(--ui-fg),0.04)] flex-1 flex flex-col min-h-0"
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)]">
              Active Flows
            </span>
            <span className="font-mono text-[10px] font-semibold text-[rgba(var(--ui-fg),0.35)] bg-[rgba(var(--ui-fg),0.04)] pl-1.75 pr-1.75 pt-0.5 pb-0.5 rounded-md">
              {formatNumber(stableFlows.length)}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-thumb]:bg-[rgba(var(--ui-fg),0.08)] [&::-webkit-scrollbar-thumb]:rounded-[1px]">
            {stableFlows.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <span className="text-[10px] text-[rgba(var(--ui-fg),0.2)] italic">
                  No active flows
                </span>
              </div>
            ) : (
              <>
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-1">
                    <tr>
                      <th className="font-mono text-[9px] font-bold tracking-[1.2px] text-[rgba(var(--ui-fg),0.2)] text-left p-1.25 bg-(--pill-bg) backdrop-blur-xl border-b border-[rgba(var(--ui-fg),0.04)] uppercase whitespace-nowrap">
                        Destination
                      </th>
                      <th className="font-mono text-[9px] font-bold tracking-[1.2px] text-[rgba(var(--ui-fg),0.2)] text-left p-1.25 bg-(--pill-bg) backdrop-blur-xl border-b border-[rgba(var(--ui-fg),0.04)] uppercase whitespace-nowrap">
                        Svc
                      </th>
                      <th className="font-mono text-[9px] font-bold tracking-[1.2px] text-[rgba(var(--ui-fg),0.2)] text-left p-1.25 bg-(--pill-bg) backdrop-blur-xl border-b border-[rgba(var(--ui-fg),0.04)] uppercase whitespace-nowrap">
                        BW
                      </th>
                      <th className="font-mono text-[9px] font-bold tracking-[1.2px] text-[rgba(var(--ui-fg),0.2)] text-left p-1.25 bg-(--pill-bg) backdrop-blur-xl border-b border-[rgba(var(--ui-fg),0.04)] uppercase whitespace-nowrap">
                        RTT
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stableFlows.slice(0, 20).map((f) => {
                      return (
                        <tr
                          key={f.id}
                          className="transition-[background] duration-150 hover:bg-[rgba(0,212,245,0.04)]"
                        >
                          <td className="pt-1 pb-1 pl-1.25 pr-1.25 font-mono text-[10px] text-[rgba(var(--ui-fg),0.4)] whitespace-nowrap overflow-hidden text-ellipsis max-w-20 tabular-nums border-b border-[rgba(var(--ui-fg),0.02)]">
                            <span
                              className={`inline-block w-0.75 h-3 rounded-[1.5px] mr-1.25 align-middle ${DIR_COLOR[f.dir] ?? "bg-(--accent-purple)"}`}
                            />
                            <span className="text-[rgba(var(--ui-fg),0.7)] font-medium">
                              {f.dst.city || f.dst.ip}
                            </span>
                          </td>
                          <td className="pt-1 pb-1 pl-1.25 pr-1.25 font-mono text-[10px] text-[rgba(var(--ui-fg),0.25)] whitespace-nowrap overflow-hidden text-ellipsis max-w-20 tabular-nums border-b border-[rgba(var(--ui-fg),0.02)]">
                            {f.service || f.port}
                          </td>
                          <td className="pt-1 pb-1 pl-1.25 pr-1.25 font-mono text-[10px] text-(--accent-cyan) whitespace-nowrap overflow-hidden text-ellipsis max-w-20 tabular-nums border-b border-[rgba(var(--ui-fg),0.02)]">
                            {formatDataRate(f.bps)}
                          </td>
                          <td className="pt-1 pb-1 pl-1.25 pr-1.25 font-mono text-[10px] text-[rgba(var(--ui-fg),0.25)] whitespace-nowrap overflow-hidden text-ellipsis max-w-20 tabular-nums border-b border-[rgba(var(--ui-fg),0.02)]">
                            {f.rtt.toFixed(0)}ms
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {flows.length > 20 && (
                  <div className="text-center text-[10px] text-[rgba(var(--ui-fg),0.25)] font-mono py-1.5">
                    Showing 20 of {formatNumber(flows.length)} flows
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </ScrollArea>
    </aside>
  );
};
