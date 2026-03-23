import React, { useEffect, useMemo } from "react";
import { ArrowLeft, ArrowLeftRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import {
  getSession,
  getSessionFrames,
  getSessionDestinations,
  type SessionInfo,
  type FrameRecord,
  type DestinationRecord,
} from "../telemetry/sessions";
import { UPlotChart, type SeriesConfig } from "./UPlotChart";
import {
  formatDataSize,
  formatDuration,
  formatTimestamp,
  formatCompact,
  pctDiff,
  safeSum,
} from "../lib/utils";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { useAsyncData } from "../lib/hooks";

interface SessionData {
  info: SessionInfo;
  frames: FrameRecord[];
  destinations: DestinationRecord[];
}

export const SessionComparison: React.FC = () => {
  const comparisonIds = useTelemetryStore((s) => s.comparisonIds);
  const setView = useTelemetryStore((s) => s.setView);
  const startComparison = useTelemetryStore((s) => s.startComparison);

  const loadSession = async (id: string): Promise<SessionData> => {
    const info = await getSession(id);
    if (!info) throw new Error("Session not found: " + id);
    const [frames, destinations] = await Promise.all([
      getSessionFrames(id),
      getSessionDestinations(id),
    ]);
    return { info, frames, destinations };
  };

  const { data, loading, error } = useAsyncData(() => {
    if (!comparisonIds) return Promise.reject("No sessions selected for comparison.");
    if (comparisonIds[0] === comparisonIds[1])
      return Promise.reject("Cannot compare a session with itself.");
    return Promise.all([loadSession(comparisonIds[0]), loadSession(comparisonIds[1])]).then(
      ([a, b]) => ({ a, b })
    );
  }, [comparisonIds?.[0], comparisonIds?.[1]]);
  const dataA = data?.a ?? null;
  const dataB = data?.b ?? null;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        setView("analytics");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setView]);

  // Guard: navigate away if either session is deleted
  useEffect(() => {
    if (!comparisonIds || !dataA || !dataB) return;
    const interval = setInterval(async () => {
      try {
        const [a, b] = await Promise.all([
          getSession(comparisonIds[0]),
          getSession(comparisonIds[1]),
        ]);
        if (!a || !b) setView("analytics");
      } catch {
        /* ignore transient errors */
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [comparisonIds, dataA, dataB, setView]);

  if (loading) {
    return (
      <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)]">
        <div className="max-w-5xl mx-auto" style={{ padding: "96px 48px 56px" }}>
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-7 w-56 mb-8" />
          <div className="grid grid-cols-2 gap-4 mb-8">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
          <Skeleton className="h-48 rounded-xl mb-6" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !dataA || !dataB) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-[rgba(var(--ui-bg),0.95)]">
        <span className="text-[15px] text-(--accent-red)">{error || "Missing session data"}</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)] overflow-y-auto">
      <div className="max-w-5xl mx-auto" style={{ padding: "96px 48px 56px" }}>
        <div className="flex items-center justify-between mb-10">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-[14px] text-[rgba(var(--ui-fg),0.35)] hover:text-[rgba(var(--ui-fg),0.7)] -ml-2"
            onClick={() => setView("analytics")}
          >
            <ArrowLeft size={14} />
            Back to analytics
          </Button>

          {comparisonIds && (
            <button
              className="flex items-center gap-1.5 text-[13px] text-[rgba(var(--ui-fg),0.3)] hover:text-[rgba(var(--ui-fg),0.6)] transition-colors cursor-pointer"
              onClick={() => startComparison(comparisonIds[1], comparisonIds[0])}
            >
              <ArrowLeftRight size={12} />
              Swap
            </button>
          )}
        </div>

        <div className="mb-10">
          <h1
            className="text-[22px] font-semibold text-[rgba(var(--ui-fg),0.88)]"
            style={{ letterSpacing: "-0.5px" }}
          >
            Comparison
          </h1>
          <p className="text-[14px] text-[rgba(var(--ui-fg),0.3)] mt-1">
            {dataA.info.name || "Unnamed"} vs {dataB.info.name || "Unnamed"}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10">
          <SessionCard session={dataA.info} label="A" />
          <SessionCard session={dataB.info} label="B" />
        </div>

        <ComparisonSummary a={dataA} b={dataB} />

        <ThroughputComparison a={dataA} b={dataB} />

        <DestinationDiff a={dataA} b={dataB} />
      </div>
    </div>
  );
};

// ─── Session Card ───────────────────────────────────────────────────────────

const SessionCard: React.FC<{
  session: SessionInfo;
  label: string;
}> = ({ session, label }) => {
  const totalBytes = safeSum(session.totalBytesUp, session.totalBytesDown);

  return (
    <div className="rounded-lg border border-[rgba(var(--ui-fg),0.05)] bg-[rgba(var(--ui-fg),0.015)] p-5">
      <div className="text-[13px] text-[rgba(var(--ui-fg),0.25)] mb-2">{label}</div>
      <div className="text-[16px] font-medium text-[rgba(var(--ui-fg),0.7)] mb-0.5">
        {session.name || "Unnamed Session"}
      </div>
      <div className="text-[13px] text-[rgba(var(--ui-fg),0.3)] mb-4 font-mono tabular-nums">
        {formatTimestamp(session.startedAt)} · {formatDuration(session.durationSecs)}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Data</div>
          <div className="text-[14px] text-[rgba(var(--ui-fg),0.55)] font-mono tabular-nums">
            {formatDataSize(totalBytes)}
          </div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Peak</div>
          <div className="text-[14px] text-[rgba(var(--ui-fg),0.55)] font-mono tabular-nums">
            {formatCompact(session.peakBps * 8, "bps")}
          </div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Latency</div>
          <div className="text-[14px] text-[rgba(var(--ui-fg),0.55)] font-mono tabular-nums">
            {(session.avgLatencyMs || 0).toFixed(0)}ms
          </div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Flows</div>
          <div className="text-[14px] text-[rgba(var(--ui-fg),0.55)] font-mono tabular-nums">
            {(session.totalFlows || 0).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Comparison Summary ─────────────────────────────────────────────────────

const ComparisonSummary: React.FC<{ a: SessionData; b: SessionData }> = ({ a, b }) => {
  const totalA = (a.info.totalBytesUp || 0) + (a.info.totalBytesDown || 0);
  const totalB = (b.info.totalBytesUp || 0) + (b.info.totalBytesDown || 0);
  const latA = a.info.avgLatencyMs || 0;
  const latB = b.info.avgLatencyMs || 0;
  const flowsA = a.info.totalFlows || 0;
  const flowsB = b.info.totalFlows || 0;
  const destA = a.destinations.length;
  const destB = b.destinations.length;

  const rows = [
    {
      label: "Total Data",
      valA: formatDataSize(totalA),
      valB: formatDataSize(totalB),
      diff: pctDiff(totalA, totalB),
    },
    {
      label: "Avg Latency",
      valA: `${latA.toFixed(0)}ms`,
      valB: `${latB.toFixed(0)}ms`,
      diff: pctDiff(latA, latB),
    },
    {
      label: "Total Flows",
      valA: String(flowsA),
      valB: String(flowsB),
      diff: pctDiff(flowsA, flowsB),
    },
    {
      label: "Destinations",
      valA: String(destA),
      valB: String(destB),
      diff: pctDiff(destA, destB),
    },
    {
      label: "Duration",
      valA: formatDuration(a.info.durationSecs),
      valB: formatDuration(b.info.durationSecs),
      diff: pctDiff(a.info.durationSecs || 0, b.info.durationSecs || 0),
    },
  ];

  return (
    <div className="mb-10">
      <SectionLabel>Metrics</SectionLabel>
      <div className="space-y-0">
        <div className="grid grid-cols-4 text-[13px] text-[rgba(var(--ui-fg),0.2)] pb-2 px-1">
          <span />
          <span className="text-center">A</span>
          <span className="text-center">B</span>
          <span className="text-right">Delta</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-4 items-center text-[14px] py-2.5 px-1 border-t border-[rgba(var(--ui-fg),0.03)] hover:bg-[rgba(var(--ui-fg),0.015)] transition-colors duration-100"
          >
            <span className="text-[rgba(var(--ui-fg),0.45)]">{r.label}</span>
            <span className="text-center font-mono tabular-nums text-[rgba(var(--ui-fg),0.55)]">
              {r.valA}
            </span>
            <span className="text-center font-mono tabular-nums text-[rgba(var(--ui-fg),0.55)]">
              {r.valB}
            </span>
            <span className="flex items-center justify-end">
              <DiffBadge diff={r.diff} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const DiffBadge: React.FC<{ diff: number }> = ({ diff }) => {
  if (!Number.isFinite(diff)) {
    return (
      <span className="text-[13px] text-[rgba(var(--ui-fg),0.2)] font-mono tabular-nums">
        \u2014
      </span>
    );
  }
  if (Math.abs(diff) < 0.5) {
    return (
      <span className="flex items-center gap-0.5 text-[13px] text-[rgba(var(--ui-fg),0.25)] font-mono tabular-nums">
        <Minus size={10} />
        0%
      </span>
    );
  }

  const isUp = diff > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;

  return (
    <span className="flex items-center gap-1 text-[13px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.55)]">
      <Icon size={11} />
      {isUp ? "+" : ""}
      {diff.toFixed(0)}%
    </span>
  );
};

// ─── Throughput Comparison Chart ────────────────────────────────────────────

const ThroughputComparison: React.FC<{ a: SessionData; b: SessionData }> = ({ a, b }) => {
  const chartData = useMemo(() => {
    // Normalize both sessions to a 0→1 timeline so they overlay regardless of actual timestamps
    const normalizeFrames = (frames: FrameRecord[]) => {
      if (frames.length === 0) return { times: [] as number[], bps: [] as number[] };
      const tMin = frames[0].t;
      const tMax = frames[frames.length - 1].t;
      const range = tMax - tMin || 1;
      return {
        times: frames.map((f) => (f.t - tMin) / range),
        bps: frames.map((f) => ((f.bps || 0) * 8) / 1e6), // Mbps
      };
    };

    const nA = normalizeFrames(a.frames);
    const nB = normalizeFrames(b.frames);

    // Resample both to 200 points on [0, 1] using binary search (O(n log m))
    const POINTS = 200;
    const resample = (times: number[], values: number[]) => {
      const result = new Float64Array(POINTS);
      if (times.length === 0) return result;
      for (let i = 0; i < POINTS; i++) {
        const t = i / (POINTS - 1);
        // Binary search for nearest sample
        let lo = 0,
          hi = times.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (times[mid] < t) lo = mid + 1;
          else hi = mid;
        }
        // Check neighbors for true nearest
        let closest = lo;
        if (lo > 0 && Math.abs(times[lo - 1] - t) < Math.abs(times[lo] - t)) {
          closest = lo - 1;
        }
        const v = values[closest];
        result[i] = Number.isFinite(v) ? v : 0;
      }
      return result;
    };

    const timeAxis = new Float64Array(POINTS);
    for (let i = 0; i < POINTS; i++) timeAxis[i] = i;

    const seriesA = nA.times.length > 0 ? resample(nA.times, nA.bps) : new Float64Array(POINTS);
    const seriesB = nB.times.length > 0 ? resample(nB.times, nB.bps) : new Float64Array(POINTS);

    return [timeAxis, seriesA, seriesB] as [Float64Array, Float64Array, Float64Array];
  }, [a.frames, b.frames]);

  const series: SeriesConfig[] = useMemo(
    () => [
      { label: "Session A", color: "cyan", fill: true },
      { label: "Session B", color: "orange", fill: true },
    ],
    []
  );

  return (
    <div className="mb-10">
      <SectionLabel>Throughput</SectionLabel>
      <p className="text-[13px] text-[rgba(var(--ui-fg),0.25)] -mt-2 mb-4">
        Normalized to relative timeline
      </p>
      <div className="rounded-lg border border-[rgba(var(--ui-fg),0.04)] bg-[rgba(var(--ui-fg),0.015)] p-4">
        <UPlotChart
          data={chartData}
          series={series}
          height={180}
          yFormat={(v) => (Number.isFinite(v) ? `${v.toFixed(1)} Mbps` : "0")}
        />
      </div>
      <div className="flex justify-between mt-2 px-1">
        <span className="text-[13px] text-[rgba(var(--ui-fg),0.15)] font-mono">0%</span>
        <span className="text-[13px] text-[rgba(var(--ui-fg),0.15)] font-mono">100%</span>
      </div>
    </div>
  );
};

// ─── Destination Diff ───────────────────────────────────────────────────────

const DestinationDiff: React.FC<{ a: SessionData; b: SessionData }> = ({ a, b }) => {
  const { onlyA, onlyB, shared } = useMemo(() => {
    const setA = new Set(a.destinations.map((d) => d.ip));
    const setB = new Set(b.destinations.map((d) => d.ip));

    const onlyAList = a.destinations.filter((d) => !setB.has(d.ip));
    const onlyBList = b.destinations.filter((d) => !setA.has(d.ip));
    const sharedList = a.destinations.filter((d) => setB.has(d.ip));

    return { onlyA: onlyAList, onlyB: onlyBList, shared: sharedList };
  }, [a.destinations, b.destinations]);

  return (
    <div className="mb-10">
      <SectionLabel>Destinations</SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <DestCol label="Only in A" count={onlyA.length} dests={onlyA.slice(0, 10)} />
        <DestCol label="Shared" count={shared.length} dests={shared.slice(0, 10)} />
        <DestCol label="Only in B" count={onlyB.length} dests={onlyB.slice(0, 10)} />
      </div>
    </div>
  );
};

const DestCol: React.FC<{
  label: string;
  count: number;
  dests: DestinationRecord[];
}> = ({ label, count, dests }) => (
  <div>
    <div className="flex items-baseline gap-2 mb-2">
      <span className="text-[13px] text-[rgba(var(--ui-fg),0.4)]">{label}</span>
      <span className="text-[13px] text-[rgba(var(--ui-fg),0.2)] font-mono tabular-nums">
        {count}
      </span>
    </div>
    {dests.length === 0 ? (
      <div className="text-[13px] text-[rgba(var(--ui-fg),0.15)]">\u2014</div>
    ) : (
      <div className="space-y-1">
        {dests.map((d) => (
          <div key={d.ip} className="text-[13px] text-[rgba(var(--ui-fg),0.45)] truncate font-mono">
            {d.org || d.ip}
            {d.city && <span className="text-[rgba(var(--ui-fg),0.2)]"> · {d.city}</span>}
          </div>
        ))}
      </div>
    )}
  </div>
);

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-3 mb-4">
    <h2 className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)] shrink-0">
      {children}
    </h2>
    <div className="flex-1 h-px bg-[rgba(var(--ui-fg),0.04)]" />
  </div>
);
