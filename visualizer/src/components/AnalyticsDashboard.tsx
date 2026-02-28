import React, { useEffect, useState, useMemo } from "react";
import {
  ArrowLeft,
  BarChart3,
  Globe,
  Cpu,
  Database,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Activity,
  Clock,
} from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import {
  getGlobalStats,
  getDailyUsage,
  getTopDestinations,
  getTopApps,
  listSessions,
  type GlobalStats,
  type DailyUsage,
  type TopDestination,
  type TopApp,
  type SessionInfo,
} from "../telemetry/sessions";
import { UPlotChart, type SeriesConfig } from "./UPlotChart";
import {
  formatDataSize,
  formatDuration,
  formatDateWithYear,
  formatCompact,
  countryFlag,
} from "../lib/utils";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";

type TimeRange = 7 | 30 | 0; // 7d, 30d, all time

export const AnalyticsDashboard: React.FC = () => {
  const setView = useTelemetryStore((s) => s.setView);

  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [daily, setDaily] = useState<DailyUsage[]>([]);
  const [destinations, setDestinations] = useState<TopDestination[]>([]);
  const [apps, setApps] = useState<TopApp[]>([]);
  const [range, setRange] = useState<TimeRange>(30);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getGlobalStats(),
      getDailyUsage(range),
      getTopDestinations(range, 15),
      getTopApps(range, 15),
    ])
      .then(([s, d, dest, a]) => {
        if (cancelled) return;
        setStats(s);
        setDaily(d);
        setDestinations(dest);
        setApps(a);
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
  }, [range]);

  // Keyboard: Escape goes back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        setView("live");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setView]);

  // ── Daily usage chart data ─────────────────────────────────────────────
  const dailyChartData = useMemo(() => {
    if (daily.length === 0) return null;

    const timestamps = new Float64Array(daily.length);
    const upload = new Float64Array(daily.length);
    const download = new Float64Array(daily.length);

    for (let i = 0; i < daily.length; i++) {
      const d = daily[i];
      // Parse "YYYY-MM-DD" to epoch seconds
      const ts = new Date(d.date + "T00:00:00").getTime() / 1000;
      timestamps[i] = Number.isFinite(ts) ? ts : 0;
      // Convert bytes to GB for chart readability
      upload[i] = Number.isFinite(d.bytesUp) ? d.bytesUp / 1e9 : 0;
      download[i] = Number.isFinite(d.bytesDown) ? d.bytesDown / 1e9 : 0;
    }

    return [timestamps, upload, download] as [
      Float64Array,
      Float64Array,
      Float64Array,
    ];
  }, [daily]);

  const dailySeries: SeriesConfig[] = useMemo(
    () => [
      { label: "Upload", color: "orange", unit: "GB", fill: true },
      { label: "Download", color: "cyan", unit: "GB", fill: true },
    ],
    [],
  );

  // ── Total traffic from daily ───────────────────────────────────────────
  const totalUp = daily.reduce((s, d) => s + (d.bytesUp || 0), 0);
  const totalDown = daily.reduce((s, d) => s + (d.bytesDown || 0), 0);
  const totalSessions = daily.reduce((s, d) => s + (d.sessionCount || 0), 0);
  const totalHours =
    daily.reduce((s, d) => s + (d.totalDurationSecs || 0), 0) / 3600;

  const rangeLabel =
    range === 7 ? "Last 7 days" : range === 30 ? "Last 30 days" : "All time";

  if (loading) {
    return (
      <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)]">
        <div
          className="max-w-5xl mx-auto"
          style={{ padding: "96px 48px 56px" }}
        >
          <Skeleton className="h-5 w-24 mb-8" />
          <Skeleton className="h-8 w-48 mb-8" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-56 rounded-2xl mb-8" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-[rgba(var(--ui-bg),0.95)]">
        <span className="text-[13px] text-(--accent-red)">Error: {error}</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)] overflow-y-auto">
      <div className="max-w-5xl mx-auto" style={{ padding: "96px 48px 56px" }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-[12px] text-[rgba(var(--ui-fg),0.4)] hover:text-[rgba(var(--ui-fg),0.7)] -ml-2"
            onClick={() => setView("live")}
          >
            <ArrowLeft size={14} />
            <span>Back to live</span>
          </Button>

          {/* Time range selector */}
          <div className="flex items-center gap-1 bg-[rgba(var(--ui-fg),0.03)] rounded-xl p-1">
            {([7, 30, 0] as TimeRange[]).map((r) => (
              <Button
                key={r}
                variant={range === r ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setRange(r)}
                className={`text-[11px] rounded-lg px-3.5 h-7 ${
                  range === r
                    ? "text-(--accent-cyan) bg-(--accent-cyan)/10 shadow-sm"
                    : "text-[rgba(var(--ui-fg),0.3)] hover:text-[rgba(var(--ui-fg),0.6)]"
                }`}
              >
                {r === 7 ? "7d" : r === 30 ? "30d" : "All"}
              </Button>
            ))}
          </div>
        </div>

        {/* Title */}
        <h1
          className="text-[20px] font-semibold text-[rgba(var(--ui-fg),0.9)] flex items-center gap-2.5 mb-1.5"
          style={{ letterSpacing: "-0.4px" }}
        >
          <BarChart3 size={20} className="text-(--accent-cyan)" />
          Network Analytics
        </h1>
        <p className="text-[13px] text-[rgba(var(--ui-fg),0.35)] mb-8">
          {rangeLabel} · {totalSessions} session
          {totalSessions !== 1 ? "s" : ""}
        </p>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <SummaryCard
            label="Total Traffic"
            value={formatDataSize(totalUp + totalDown)}
            icon={<Activity size={14} />}
            color="var(--accent-cyan)"
          />
          <SummaryCard
            label="Upload"
            value={formatDataSize(totalUp)}
            icon={<ArrowUp size={14} />}
            color="var(--accent-orange)"
          />
          <SummaryCard
            label="Download"
            value={formatDataSize(totalDown)}
            icon={<ArrowDown size={14} />}
            color="var(--accent-cyan)"
          />
          <SummaryCard
            label="Recording Time"
            value={formatDuration(totalHours * 3600)}
            icon={<Clock size={14} />}
            color="var(--accent-purple)"
          />
        </div>

        {/* Global stats row */}
        {stats && (
          <div className="grid grid-cols-3 gap-4 mb-10">
            <MiniStat
              label="Database Size"
              value={`${Number.isFinite(stats.databaseSizeMb) ? stats.databaseSizeMb.toFixed(1) : "0.0"} MB`}
            />
            <MiniStat
              label="Oldest Session"
              value={
                stats.oldestSession
                  ? formatDateWithYear(stats.oldestSession)
                  : "—"
              }
            />
            <MiniStat
              label="Newest Session"
              value={
                stats.newestSession
                  ? formatDateWithYear(stats.newestSession)
                  : "—"
              }
            />
          </div>
        )}

        {/* Daily usage chart */}
        <SectionHeader
          icon={<BarChart3 size={14} />}
          title="Daily Data Usage"
        />
        {dailyChartData ? (
          <div className="mb-10">
            <UPlotChart
              data={dailyChartData}
              series={dailySeries}
              height={220}
              timeAxis
              yFormat={(v) =>
                Number.isFinite(v) ? `${v.toFixed(1)} GB` : "0 GB"
              }
            />
          </div>
        ) : (
          <EmptyState message="No daily usage data yet" />
        )}

        {/* Two-column layout: destinations + apps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-10">
          {/* Top Destinations */}
          <div>
            <SectionHeader
              icon={<Globe size={14} />}
              title="Top Destinations"
            />
            {destinations.length > 0 ? (
              <div className="space-y-0.5">
                {destinations.map((d, i) => (
                  <DestinationRow key={d.ip} rank={i + 1} dest={d} />
                ))}
              </div>
            ) : (
              <EmptyState message="No destination data" />
            )}
          </div>

          {/* Top Apps */}
          <div>
            <SectionHeader icon={<Cpu size={14} />} title="Top Applications" />
            {apps.length > 0 ? (
              <div className="space-y-0.5">
                {apps.map((a, i) => (
                  <AppRow key={a.processName} rank={i + 1} app={a} />
                ))}
              </div>
            ) : (
              <EmptyState message="No process data" />
            )}
          </div>
        </div>

        {/* Session comparison picker */}
        <CompareSessionsPicker />
      </div>
    </div>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────

const SummaryCard: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}> = ({ label, value, icon, color }) => (
  <div
    className="rounded-2xl border border-[rgba(var(--ui-fg),0.04)] bg-[rgba(var(--ui-fg),0.02)] card-hover"
    style={{ padding: "18px 20px" }}
  >
    <div
      className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-medium mb-3"
      style={{ color: `color-mix(in srgb, ${color}, transparent 35%)` }}
    >
      {icon}
      {label}
    </div>
    <div
      className="text-[20px] font-semibold text-[rgba(var(--ui-fg),0.85)]"
      style={{ letterSpacing: "-0.3px" }}
    >
      {value}
    </div>
  </div>
);

const MiniStat: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div
    className="rounded-xl border border-[rgba(var(--ui-fg),0.03)] bg-[rgba(var(--ui-fg),0.015)]"
    style={{ padding: "14px 18px" }}
  >
    <div className="text-[10px] text-[rgba(var(--ui-fg),0.3)] uppercase tracking-wider mb-1.5">
      {label}
    </div>
    <div className="text-[13px] text-[rgba(var(--ui-fg),0.55)] font-medium">
      {value}
    </div>
  </div>
);

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
}> = ({ icon, title }) => (
  <div className="flex items-center gap-2.5 mb-4">
    <span className="text-(--accent-cyan)">{icon}</span>
    <h2 className="text-[14px] font-medium text-[rgba(var(--ui-fg),0.6)]">
      {title}
    </h2>
  </div>
);

const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div
    className="rounded-2xl border border-[rgba(var(--ui-fg),0.03)] bg-[rgba(var(--ui-fg),0.015)] text-[13px] text-[rgba(var(--ui-fg),0.25)] text-center"
    style={{ padding: "40px 20px" }}
  >
    {message}
  </div>
);

const DestinationRow: React.FC<{
  rank: number;
  dest: TopDestination;
}> = ({ rank, dest }) => {
  const displayName = dest.org || dest.ip;
  const location = [dest.city, dest.country].filter(Boolean).join(", ");

  return (
    <div
      className="flex items-center gap-3 rounded-xl hover:bg-[rgba(var(--ui-fg),0.02)] transition-colors"
      style={{ padding: "8px 12px" }}
    >
      <span className="text-[10px] text-[rgba(var(--ui-fg),0.2)] w-5 text-right font-mono">
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[rgba(var(--ui-fg),0.6)] truncate">
          {displayName}
        </div>
        {location && (
          <div className="text-[10px] text-[rgba(var(--ui-fg),0.25)] mt-0.5">
            {location}
          </div>
        )}
      </div>
      <div className="text-right">
        <div className="text-[12px] text-[rgba(var(--ui-fg),0.5)] font-mono">
          {formatDataSize(dest.totalBytes)}
        </div>
        <div className="text-[10px] text-[rgba(var(--ui-fg),0.2)]">
          {dest.connectionCount} conn
        </div>
      </div>
    </div>
  );
};

const AppRow: React.FC<{
  rank: number;
  app: TopApp;
}> = ({ rank, app }) => {
  const total = (app.totalBytesUp || 0) + (app.totalBytesDown || 0);

  return (
    <div
      className="flex items-center gap-3 rounded-xl hover:bg-[rgba(var(--ui-fg),0.02)] transition-colors"
      style={{ padding: "8px 12px" }}
    >
      <span className="text-[10px] text-[rgba(var(--ui-fg),0.2)] w-5 text-right font-mono">
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[rgba(var(--ui-fg),0.6)] truncate">
          {app.processName || "Unknown"}
        </div>
        <div className="text-[10px] text-[rgba(var(--ui-fg),0.25)] mt-0.5">
          ↑{formatDataSize(app.totalBytesUp)} ↓
          {formatDataSize(app.totalBytesDown)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[12px] text-[rgba(var(--ui-fg),0.5)] font-mono">
          {formatDataSize(total)}
        </div>
        <div className="text-[10px] text-[rgba(var(--ui-fg),0.2)]">
          {app.avgRtt > 0
            ? `${Number.isFinite(app.avgRtt) ? app.avgRtt.toFixed(0) : "0"}ms avg`
            : `${app.totalFlows} flows`}
        </div>
      </div>
    </div>
  );
};

// ─── Compare Sessions Picker ────────────────────────────────────────────────

const CompareSessionsPicker: React.FC = () => {
  const startComparison = useTelemetryStore((s) => s.startComparison);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [idA, setIdA] = useState<string>("");
  const [idB, setIdB] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listSessions(100, 0)
      .then((list) => {
        setSessions(list);
        if (list.length >= 2) {
          setIdA(list[0].id);
          setIdB(list[1].id);
        }
      })
      .catch((e) => {
        console.error("[CompareSessionsPicker] Failed to load sessions:", e);
      })
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || sessions.length < 2) {
    return (
      <div className="mb-8">
        <SectionHeader
          icon={<ArrowUpDown size={14} />}
          title="Compare Sessions"
        />
        <EmptyState
          message={
            loaded ? "Need at least 2 sessions to compare" : "Loading sessions…"
          }
        />
      </div>
    );
  }

  const canCompare = idA && idB && idA !== idB;

  return (
    <div className="mb-8">
      <SectionHeader
        icon={<ArrowUpDown size={14} />}
        title="Compare Sessions"
      />
      <div
        className="rounded-(--pill-radius) border border-(--pill-border) bg-(--pill-bg) backdrop-blur-xl"
        style={{ padding: "22px 24px" }}
      >
        <div className="mb-4 flex items-center justify-between gap-3 max-[760px]:mb-3 max-[760px]:flex-col max-[760px]:items-start">
          <span className="text-[12px] font-medium text-[rgba(var(--ui-fg),0.62)]">
            Pick two sessions to open side-by-side analysis.
          </span>
          <span className="text-[11px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.36)]">
            {sessions.length} available
          </span>
        </div>

        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-4 max-[760px]:grid-cols-1">
          <SessionSelect
            label="Session A"
            value={idA}
            sessions={sessions}
            onChange={setIdA}
          />
          <SessionSelect
            label="Session B"
            value={idB}
            sessions={sessions}
            onChange={setIdB}
          />
          <Button
            disabled={!canCompare}
            onClick={() => canCompare && startComparison(idA, idB)}
            size="sm"
            className={`h-9 min-w-26 text-[11px] font-semibold tracking-[0.4px] uppercase whitespace-nowrap ${
              canCompare
                ? "border border-(--accent-cyan)/25 bg-(--accent-cyan)/12 text-(--accent-cyan) hover:bg-(--accent-cyan)/20"
                : "border border-[rgba(var(--ui-fg),0.08)] bg-[rgba(var(--ui-fg),0.02)] text-[rgba(var(--ui-fg),0.3)] cursor-not-allowed"
            }`}
          >
            Compare
          </Button>
        </div>
      </div>
    </div>
  );
};

const SessionSelect: React.FC<{
  label: string;
  value: string;
  sessions: SessionInfo[];
  onChange: (id: string) => void;
}> = ({ label, value, sessions, onChange }) => (
  <div className="flex-1 min-w-0">
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[1.1px] text-[rgba(var(--ui-fg),0.34)]">
      {label}
    </div>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full border-[rgba(var(--ui-fg),0.08)] bg-[rgba(var(--ui-fg),0.02)] text-[12px] text-[rgba(var(--ui-fg),0.78)]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {sessions.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name || "Unnamed"} — {formatDateWithYear(s.startedAt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

// ─── Helpers ────────────────────────────────────────────────────────────────
