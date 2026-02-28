import React, { useEffect, useState, useMemo } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
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

interface SessionData {
  info: SessionInfo;
  frames: FrameRecord[];
  destinations: DestinationRecord[];
}

export const SessionComparison: React.FC = () => {
  const comparisonIds = useTelemetryStore((s) => s.comparisonIds);
  const setView = useTelemetryStore((s) => s.setView);
  const startComparison = useTelemetryStore((s) => s.startComparison);

  const [dataA, setDataA] = useState<SessionData | null>(null);
  const [dataB, setDataB] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!comparisonIds) {
      setLoading(false);
      setError("No sessions selected for comparison.");
      return;
    }
    if (comparisonIds[0] === comparisonIds[1]) {
      setLoading(false);
      setError("Cannot compare a session with itself.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadSession = async (id: string): Promise<SessionData | null> => {
      const info = await getSession(id);
      if (!info) return null;
      const [frames, destinations] = await Promise.all([
        getSessionFrames(id),
        getSessionDestinations(id),
      ]);
      return { info, frames, destinations };
    };

    Promise.all([loadSession(comparisonIds[0]), loadSession(comparisonIds[1])])
      .then(([a, b]) => {
        if (cancelled) return;
        if (!a || !b) {
          setError("One or both sessions could not be loaded.");
          return;
        }
        setDataA(a);
        setDataB(b);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [comparisonIds]);

  // Escape goes back
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

  // Guard: periodically validate that both sessions still exist
  useEffect(() => {
    if (!comparisonIds || !dataA || !dataB) return;
    const interval = setInterval(async () => {
      try {
        const [a, b] = await Promise.all([
          getSession(comparisonIds[0]),
          getSession(comparisonIds[1]),
        ]);
        if (!a || !b) {
          setError("One or both sessions were deleted.");
          setDataA(null);
          setDataB(null);
        }
      } catch {
        // Silently ignore transient errors
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [comparisonIds, dataA, dataB]);

  if (loading) {
    return (
      <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)]">
        <div
          className="max-w-5xl mx-auto"
          style={{ padding: "96px 48px 56px" }}
        >
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
        <span className="text-[13px] text-(--accent-red)">
          {error || "Missing session data"}
        </span>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)] overflow-y-auto">
      <div className="max-w-5xl mx-auto" style={{ padding: "96px 48px 56px" }}>
        {/* Header */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-[12px] text-[rgba(var(--ui-fg),0.4)] hover:text-[rgba(var(--ui-fg),0.7)] mb-4"
          onClick={() => setView("analytics")}
        >
          <ArrowLeft size={13} />
          <span>Back to analytics</span>
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <h1
            className="text-[18px] font-semibold text-[rgba(var(--ui-fg),0.85)] flex items-center gap-2"
            style={{ letterSpacing: "-0.3px" }}
          >
            <ArrowUpDown size={18} className="text-(--accent-purple)" />
            Session Comparison
          </h1>
          {comparisonIds && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-[11px] text-[rgba(var(--ui-fg),0.4)] hover:text-[rgba(var(--ui-fg),0.7)]"
              onClick={() =>
                startComparison(comparisonIds[1], comparisonIds[0])
              }
            >
              <ArrowLeftRight size={12} />
              Swap A/B
            </Button>
          )}
        </div>

        {/* Side-by-side summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <SessionCard
            session={dataA.info}
            label="Session A"
            color="var(--accent-cyan)"
          />
          <SessionCard
            session={dataB.info}
            label="Session B"
            color="var(--accent-orange)"
          />
        </div>

        {/* Comparison summary */}
        <ComparisonSummary a={dataA} b={dataB} />

        {/* Throughput overlay chart */}
        <ThroughputComparison a={dataA} b={dataB} />

        {/* Destination diff */}
        <DestinationDiff a={dataA} b={dataB} />
      </div>
    </div>
  );
};

// ─── Session Card ───────────────────────────────────────────────────────────

const SessionCard: React.FC<{
  session: SessionInfo;
  label: string;
  color: string;
}> = ({ session, label, color }) => {
  const totalBytes = safeSum(session.totalBytesUp, session.totalBytesDown);

  return (
    <div
      className="rounded-xl border bg-[rgba(var(--ui-fg),0.02)]"
      style={{
        padding: "16px 18px",
        borderColor: `color-mix(in srgb, ${color}, transparent 70%)`,
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wider font-semibold mb-2"
        style={{ color }}
      >
        {label}
      </div>
      <div className="text-[14px] font-medium text-[rgba(var(--ui-fg),0.75)] mb-1">
        {session.name || "Unnamed Session"}
      </div>
      <div className="text-[11px] text-[rgba(var(--ui-fg),0.35)] mb-3">
        {formatTimestamp(session.startedAt)} ·{" "}
        {formatDuration(session.durationSecs)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MiniMetric label="Total Data" value={formatDataSize(totalBytes)} />
        <MiniMetric
          label="Peak"
          value={formatCompact(session.peakBps * 8, "bps")}
        />
        <MiniMetric
          label="Avg Latency"
          value={`${(session.avgLatencyMs || 0).toFixed(0)}ms`}
        />
        <MiniMetric label="Flows" value={String(session.totalFlows || 0)} />
      </div>
    </div>
  );
};

const MiniMetric: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div>
    <div className="text-[9px] text-[rgba(var(--ui-fg),0.25)] uppercase tracking-wider">
      {label}
    </div>
    <div className="text-[12px] text-[rgba(var(--ui-fg),0.6)] font-mono">
      {value}
    </div>
  </div>
);

// ─── Comparison Summary ─────────────────────────────────────────────────────

const ComparisonSummary: React.FC<{ a: SessionData; b: SessionData }> = ({
  a,
  b,
}) => {
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
    <div className="mb-8">
      <SectionHeader title="Metric Comparison" />
      <div className="rounded-xl border border-[rgba(var(--ui-fg),0.06)] overflow-hidden">
        {/* Header row */}
        <div
          className="grid grid-cols-4 text-[10px] uppercase tracking-wider text-[rgba(var(--ui-fg),0.3)] border-b border-[rgba(var(--ui-fg),0.04)]"
          style={{ padding: "8px 14px" }}
        >
          <span>Metric</span>
          <span className="text-center">Session A</span>
          <span className="text-center">Session B</span>
          <span className="text-right">Difference</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-4 text-[12px] border-b border-[rgba(var(--ui-fg),0.03)] last:border-b-0 transition-colors duration-100 hover:bg-[rgba(var(--ui-fg),0.03)]"
            style={{ padding: "8px 14px" }}
          >
            <span className="text-[rgba(var(--ui-fg),0.5)]">{r.label}</span>
            <span className="text-center font-mono text-[rgba(var(--ui-fg),0.6)]">
              {r.valA}
            </span>
            <span className="text-center font-mono text-[rgba(var(--ui-fg),0.6)]">
              {r.valB}
            </span>
            <span className="text-right flex items-center justify-end gap-1">
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
      <span className="flex items-center gap-0.5 text-[11px] text-[rgba(var(--ui-fg),0.4)] font-mono">
        N/A
      </span>
    );
  }
  if (Math.abs(diff) < 0.5) {
    return (
      <span className="flex items-center gap-0.5 text-[11px] text-[rgba(var(--ui-fg),0.3)]">
        <Minus size={10} />
        ~0%
      </span>
    );
  }

  const isUp = diff > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  const color = isUp ? "var(--accent-orange)" : "var(--accent-cyan)";

  return (
    <span
      className="flex items-center gap-0.5 text-[11px] font-mono"
      style={{ color }}
    >
      <Icon size={10} />
      {isUp ? "+" : ""}
      {diff.toFixed(0)}%
    </span>
  );
};

// ─── Throughput Comparison Chart ────────────────────────────────────────────

const ThroughputComparison: React.FC<{ a: SessionData; b: SessionData }> = ({
  a,
  b,
}) => {
  const chartData = useMemo(() => {
    // Normalize both sessions to a 0→1 timeline so they overlay regardless of actual timestamps
    const normalizeFrames = (frames: FrameRecord[]) => {
      if (frames.length === 0)
        return { times: [] as number[], bps: [] as number[] };
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

    const seriesA =
      nA.times.length > 0
        ? resample(nA.times, nA.bps)
        : new Float64Array(POINTS);
    const seriesB =
      nB.times.length > 0
        ? resample(nB.times, nB.bps)
        : new Float64Array(POINTS);

    return [timeAxis, seriesA, seriesB] as [
      Float64Array,
      Float64Array,
      Float64Array,
    ];
  }, [a.frames, b.frames]);

  const series: SeriesConfig[] = useMemo(
    () => [
      { label: "Session A", color: "cyan", fill: true },
      { label: "Session B", color: "orange", fill: true },
    ],
    [],
  );

  return (
    <div className="mb-8">
      <SectionHeader title="Throughput Overlay" />
      <p className="text-[10px] text-[rgba(var(--ui-fg),0.25)] mb-2">
        Both sessions normalized to relative timeline for comparison
      </p>
      <UPlotChart
        data={chartData}
        series={series}
        height={180}
        yFormat={(v) => (Number.isFinite(v) ? `${v.toFixed(1)} Mbps` : "0")}
      />
      <div className="flex justify-between mt-1 px-1">
        <span className="text-[9px] text-[rgba(var(--ui-fg),0.2)] font-medium">
          Start
        </span>
        <span className="text-[9px] text-[rgba(var(--ui-fg),0.2)] font-medium">
          End →
        </span>
      </div>
    </div>
  );
};

// ─── Destination Diff ───────────────────────────────────────────────────────

const DestinationDiff: React.FC<{ a: SessionData; b: SessionData }> = ({
  a,
  b,
}) => {
  const { onlyA, onlyB, shared } = useMemo(() => {
    const setA = new Set(a.destinations.map((d) => d.ip));
    const setB = new Set(b.destinations.map((d) => d.ip));

    const onlyAList = a.destinations.filter((d) => !setB.has(d.ip));
    const onlyBList = b.destinations.filter((d) => !setA.has(d.ip));
    const sharedList = a.destinations.filter((d) => setB.has(d.ip));

    return { onlyA: onlyAList, onlyB: onlyBList, shared: sharedList };
  }, [a.destinations, b.destinations]);

  return (
    <div className="mb-8">
      <SectionHeader title="Destination Differences" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <DestCol
          label={`Only in A (${onlyA.length})`}
          color="var(--accent-cyan)"
          dests={onlyA.slice(0, 10)}
        />
        <DestCol
          label={`Shared (${shared.length})`}
          color="rgba(var(--ui-fg), 0.4)"
          dests={shared.slice(0, 10)}
        />
        <DestCol
          label={`Only in B (${onlyB.length})`}
          color="var(--accent-orange)"
          dests={onlyB.slice(0, 10)}
        />
      </div>
    </div>
  );
};

const DestCol: React.FC<{
  label: string;
  color: string;
  dests: DestinationRecord[];
}> = ({ label, color, dests }) => (
  <div>
    <div
      className="text-[10px] uppercase tracking-wider font-semibold mb-2"
      style={{ color }}
    >
      {label}
    </div>
    {dests.length === 0 ? (
      <div className="text-[11px] text-[rgba(var(--ui-fg),0.2)]">None</div>
    ) : (
      <div className="space-y-0.5">
        {dests.map((d) => (
          <div
            key={d.ip}
            className="text-[11px] text-[rgba(var(--ui-fg),0.5)] truncate"
          >
            {d.org || d.ip}
            {d.city && (
              <span className="text-[rgba(var(--ui-fg),0.25)]">
                {" "}
                · {d.city}
              </span>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

// ─── Shared sub-components ──────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <h2 className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.6)] mb-3">
    {title}
  </h2>
);

// ─── Helpers ────────────────────────────────────────────────────────────────
