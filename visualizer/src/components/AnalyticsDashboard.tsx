import React, { useEffect, useState, useMemo } from "react";
import { ArrowLeft } from "lucide-react";
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
import { formatDataSize, formatDuration, formatDateWithYear, countryFlag } from "../lib/utils";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { useAsyncData } from "../lib/hooks";

type TimeRange = 7 | 30 | 0;

export const AnalyticsDashboard: React.FC = () => {
  const setView = useTelemetryStore((s) => s.setView);

  const [range, setRange] = useState<TimeRange>(30);
  const { data, loading, error } = useAsyncData(
    () =>
      Promise.all([
        getGlobalStats(),
        getDailyUsage(range),
        getTopDestinations(range, 15),
        getTopApps(range, 15),
      ]).then(([stats, daily, destinations, apps]) => ({ stats, daily, destinations, apps })),
    [range]
  );
  const stats = data?.stats ?? null;
  const daily = data?.daily ?? [];
  const destinations = data?.destinations ?? [];
  const apps = data?.apps ?? [];

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

  const dailyChartData = useMemo(() => {
    if (daily.length === 0) return null;
    const timestamps = new Float64Array(daily.length);
    const upload = new Float64Array(daily.length);
    const download = new Float64Array(daily.length);
    for (let i = 0; i < daily.length; i++) {
      const d = daily[i];
      const ts = new Date(d.date + "T00:00:00").getTime() / 1000;
      timestamps[i] = Number.isFinite(ts) ? ts : 0;
      upload[i] = Number.isFinite(d.bytesUp) ? d.bytesUp / 1e9 : 0;
      download[i] = Number.isFinite(d.bytesDown) ? d.bytesDown / 1e9 : 0;
    }
    return [timestamps, upload, download] as [Float64Array, Float64Array, Float64Array];
  }, [daily]);

  const dailySeries: SeriesConfig[] = useMemo(
    () => [
      { label: "Upload", color: "orange", unit: "GB", fill: true },
      { label: "Download", color: "cyan", unit: "GB", fill: true },
    ],
    []
  );

  const totalUp = daily.reduce((s, d) => s + (d.bytesUp || 0), 0);
  const totalDown = daily.reduce((s, d) => s + (d.bytesDown || 0), 0);
  const totalSessions = daily.reduce((s, d) => s + (d.sessionCount || 0), 0);
  const totalHours = daily.reduce((s, d) => s + (d.totalDurationSecs || 0), 0) / 3600;
  const rangeLabel = range === 7 ? "Last 7 days" : range === 30 ? "Last 30 days" : "All time";

  if (loading) {
    return (
      <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)]">
        <div className="max-w-5xl mx-auto" style={{ padding: "96px 48px 56px" }}>
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
        <span className="text-[15px] text-(--accent-red)">Error: {error}</span>
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
            onClick={() => setView("live")}
          >
            <ArrowLeft size={14} />
            Back to live
          </Button>

          <div className="flex items-center gap-0.5 bg-[rgba(var(--ui-fg),0.03)] border border-[rgba(var(--ui-fg),0.04)] rounded-lg p-0.5">
            {([7, 30, 0] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`text-[13px] font-medium rounded-md px-3 py-1.5 transition-all duration-150 ${
                  range === r
                    ? "text-(--accent-cyan) bg-(--accent-cyan)/8 shadow-sm"
                    : "text-[rgba(var(--ui-fg),0.3)] hover:text-[rgba(var(--ui-fg),0.5)]"
                }`}
              >
                {r === 7 ? "7d" : r === 30 ? "30d" : "All"}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-10">
          <h1
            className="text-[22px] font-semibold text-[rgba(var(--ui-fg),0.88)]"
            style={{ letterSpacing: "-0.5px" }}
          >
            Analytics
          </h1>
          <p className="text-[14px] text-[rgba(var(--ui-fg),0.3)] mt-1 font-mono tabular-nums">
            {rangeLabel} · {totalSessions} session{totalSessions !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-baseline gap-12 mb-10 flex-wrap">
          <div className="min-w-28">
            <div className="text-[13px] text-[rgba(var(--ui-fg),0.3)] mb-1">Traffic</div>
            <div
              className="text-[20px] font-semibold text-[rgba(var(--ui-fg),0.85)] font-mono tabular-nums"
              style={{ letterSpacing: "-0.5px" }}
            >
              {formatDataSize(totalUp + totalDown)}
            </div>
          </div>
          <div className="w-px h-8 bg-[rgba(var(--ui-fg),0.06)] self-center" />
          <div className="min-w-24">
            <div className="text-[13px] text-[rgba(var(--ui-fg),0.3)] mb-1">Up</div>
            <div className="text-[17px] font-medium text-(--accent-orange)/70 font-mono tabular-nums">
              {formatDataSize(totalUp)}
            </div>
          </div>
          <div className="min-w-24">
            <div className="text-[13px] text-[rgba(var(--ui-fg),0.3)] mb-1">Down</div>
            <div className="text-[17px] font-medium text-(--accent-cyan)/70 font-mono tabular-nums">
              {formatDataSize(totalDown)}
            </div>
          </div>
          <div className="w-px h-8 bg-[rgba(var(--ui-fg),0.06)] self-center" />
          <div className="min-w-28">
            <div className="text-[13px] text-[rgba(var(--ui-fg),0.3)] mb-1">Recording</div>
            <div className="text-[17px] font-medium text-[rgba(var(--ui-fg),0.6)] font-mono tabular-nums">
              {formatDuration(totalHours * 3600)}
            </div>
          </div>
        </div>

        {stats && (
          <div className="flex items-center gap-6 mb-10 text-[13px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.35)]">
            <span>
              DB{" "}
              <span className="text-[rgba(var(--ui-fg),0.55)] font-semibold">
                {Number.isFinite(stats.databaseSizeMb) ? stats.databaseSizeMb.toFixed(1) : "0.0"} MB
              </span>
            </span>
            <span className="text-[rgba(var(--ui-fg),0.1)]">|</span>
            <span>
              Oldest{" "}
              <span className="text-[rgba(var(--ui-fg),0.55)]">
                {stats.oldestSession ? formatDateWithYear(stats.oldestSession) : "\u2014"}
              </span>
            </span>
            <span className="text-[rgba(var(--ui-fg),0.1)]">|</span>
            <span>
              Newest{" "}
              <span className="text-[rgba(var(--ui-fg),0.55)]">
                {stats.newestSession ? formatDateWithYear(stats.newestSession) : "\u2014"}
              </span>
            </span>
          </div>
        )}

        <section className="mb-10">
          <SectionLabel>Daily Usage</SectionLabel>
          {dailyChartData ? (
            <div className="rounded-xl border border-[rgba(var(--ui-fg),0.04)] bg-[rgba(var(--ui-fg),0.015)] p-4">
              <UPlotChart
                data={dailyChartData}
                series={dailySeries}
                height={200}
                timeAxis
                yFormat={(v) => (Number.isFinite(v) ? `${v.toFixed(1)} GB` : "0 GB")}
              />
            </div>
          ) : (
            <EmptyBlock>No daily usage data yet</EmptyBlock>
          )}
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-10">
          <section>
            <SectionLabel>Top Destinations</SectionLabel>
            {destinations.length > 0 ? (
              <div className="rounded-xl border border-[rgba(var(--ui-fg),0.04)] bg-[rgba(var(--ui-fg),0.015)] divide-y divide-[rgba(var(--ui-fg),0.04)] overflow-hidden">
                {destinations.map((d, i) => (
                  <DestinationRow
                    key={d.ip}
                    rank={i + 1}
                    dest={d}
                    maxBytes={destinations[0]?.totalBytes || 1}
                  />
                ))}
              </div>
            ) : (
              <EmptyBlock>No destination data</EmptyBlock>
            )}
          </section>
          <section>
            <SectionLabel>Top Applications</SectionLabel>
            {apps.length > 0 ? (
              <div className="rounded-xl border border-[rgba(var(--ui-fg),0.04)] bg-[rgba(var(--ui-fg),0.015)] divide-y divide-[rgba(var(--ui-fg),0.04)] overflow-hidden">
                {apps.map((a, i) => (
                  <AppRow
                    key={a.processName}
                    rank={i + 1}
                    app={a}
                    maxBytes={(apps[0]?.totalBytesUp || 0) + (apps[0]?.totalBytesDown || 0) || 1}
                  />
                ))}
              </div>
            ) : (
              <EmptyBlock>No process data</EmptyBlock>
            )}
          </section>
        </div>

        <CompareSessionsPicker />
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-3 mb-4">
    <h2 className="text-[13px] font-bold tracking-[1.5px] uppercase text-[rgba(var(--ui-fg),0.25)] shrink-0">
      {children}
    </h2>
    <div className="flex-1 h-px bg-[rgba(var(--ui-fg),0.04)]" />
  </div>
);

const EmptyBlock: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="rounded-xl border border-[rgba(var(--ui-fg),0.03)] bg-[rgba(var(--ui-fg),0.01)] text-[14px] text-[rgba(var(--ui-fg),0.2)] text-center"
    style={{ padding: "40px 20px" }}
  >
    {children}
  </div>
);

const DestinationRow: React.FC<{ rank: number; dest: TopDestination; maxBytes: number }> = ({
  rank,
  dest,
  maxBytes,
}) => {
  const displayName = dest.org || dest.ip;
  const location = [dest.city, dest.country].filter(Boolean).join(", ");
  const pct = Math.max((dest.totalBytes / maxBytes) * 100, 0.5);
  return (
    <div
      className="relative flex items-center gap-3 hover:bg-[rgba(var(--ui-fg),0.02)] transition-colors duration-100"
      style={{ padding: "10px 14px" }}
    >
      <div
        className="absolute inset-y-0 left-0 bg-(--accent-cyan) opacity-[0.025]"
        style={{ width: `${pct}%` }}
      />
      <span className="text-[13px] text-[rgba(var(--ui-fg),0.18)] w-5 text-right font-mono tabular-nums relative">
        {rank}
      </span>
      <div className="flex-1 min-w-0 relative">
        <div className="text-[14px] font-medium text-[rgba(var(--ui-fg),0.6)] truncate">
          {displayName}
        </div>
        {location && (
          <div className="text-[13px] text-[rgba(var(--ui-fg),0.25)] mt-0.5 flex items-center gap-1">
            {dest.country && (
              <span className="text-[12px] leading-none">{countryFlag(dest.country)}</span>
            )}
            <span className="truncate">{location}</span>
          </div>
        )}
      </div>
      <div className="text-right relative shrink-0">
        <div className="text-[13px] text-[rgba(var(--ui-fg),0.5)] font-mono tabular-nums">
          {formatDataSize(dest.totalBytes)}
        </div>
        <div className="text-[13px] text-[rgba(var(--ui-fg),0.2)] font-mono tabular-nums">
          {dest.connectionCount} conn
        </div>
      </div>
    </div>
  );
};

const AppRow: React.FC<{ rank: number; app: TopApp; maxBytes: number }> = ({
  rank,
  app,
  maxBytes,
}) => {
  const total = (app.totalBytesUp || 0) + (app.totalBytesDown || 0);
  const pct = Math.max((total / maxBytes) * 100, 0.5);
  return (
    <div
      className="relative flex items-center gap-3 hover:bg-[rgba(var(--ui-fg),0.02)] transition-colors duration-100"
      style={{ padding: "10px 14px" }}
    >
      <div
        className="absolute inset-y-0 left-0 bg-(--accent-purple) opacity-[0.025]"
        style={{ width: `${pct}%` }}
      />
      <span className="text-[13px] text-[rgba(var(--ui-fg),0.18)] w-5 text-right font-mono tabular-nums relative">
        {rank}
      </span>
      <div className="flex-1 min-w-0 relative">
        <div className="text-[14px] font-medium text-[rgba(var(--ui-fg),0.6)] truncate">
          {app.processName || "Unknown"}
        </div>
        <div className="text-[13px] text-[rgba(var(--ui-fg),0.25)] mt-0.5 font-mono tabular-nums">
          <span className="text-(--accent-orange)/60">
            {"\u2191"}
            {formatDataSize(app.totalBytesUp)}
          </span>{" "}
          <span className="text-(--accent-cyan)/60">
            {"\u2193"}
            {formatDataSize(app.totalBytesDown)}
          </span>
        </div>
      </div>
      <div className="text-right relative shrink-0">
        <div className="text-[13px] text-[rgba(var(--ui-fg),0.5)] font-mono tabular-nums">
          {formatDataSize(total)}
        </div>
        <div className="text-[13px] text-[rgba(var(--ui-fg),0.2)] font-mono tabular-nums">
          {app.avgRtt > 0
            ? `${Number.isFinite(app.avgRtt) ? app.avgRtt.toFixed(0) : "0"}ms avg`
            : `${app.totalFlows} flows`}
        </div>
      </div>
    </div>
  );
};

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
      .catch((e) => console.error("[CompareSessionsPicker] Failed to load sessions:", e))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || sessions.length < 2) {
    return (
      <section className="mb-8">
        <SectionLabel>Compare</SectionLabel>
        <EmptyBlock>
          {loaded ? "Need at least 2 sessions to compare" : "Loading sessions\u2026"}
        </EmptyBlock>
      </section>
    );
  }

  const canCompare = idA && idB && idA !== idB;
  const selectedA = sessions.find((s) => s.id === idA);
  const selectedB = sessions.find((s) => s.id === idB);

  return (
    <section className="mb-8">
      <SectionLabel>Compare</SectionLabel>
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-4 max-[760px]:grid-cols-1 max-[760px]:gap-3">
        <SessionSlot value={idA} sessions={sessions} session={selectedA} onChange={setIdA} />
        <div className="flex flex-col items-center justify-center gap-3 max-[760px]:flex-row">
          <div className="w-px flex-1 bg-[rgba(var(--ui-fg),0.04)] max-[760px]:hidden" />
          <span className="text-[13px] text-[rgba(var(--ui-fg),0.12)] select-none">vs</span>
          <div className="w-px flex-1 bg-[rgba(var(--ui-fg),0.04)] max-[760px]:hidden" />
        </div>
        <SessionSlot value={idB} sessions={sessions} session={selectedB} onChange={setIdB} />
      </div>
      <div className="mt-5 flex justify-end">
        <button
          disabled={!canCompare}
          onClick={() => canCompare && startComparison(idA, idB)}
          className={`text-[13px] font-medium h-8 rounded-md px-5 transition-all duration-150 ${
            canCompare
              ? "bg-[rgba(var(--ui-fg),0.82)] text-[rgba(var(--ui-bg),1)] hover:bg-[rgba(var(--ui-fg),0.95)] cursor-pointer"
              : "bg-[rgba(var(--ui-fg),0.04)] text-[rgba(var(--ui-fg),0.15)] cursor-not-allowed"
          }`}
        >
          Open comparison
        </button>
      </div>
    </section>
  );
};

const SessionSlot: React.FC<{
  value: string;
  sessions: SessionInfo[];
  session?: SessionInfo;
  onChange: (id: string) => void;
}> = ({ value, sessions, session, onChange }) => (
  <div className="rounded-lg border border-[rgba(var(--ui-fg),0.05)] bg-[rgba(var(--ui-fg),0.015)] p-4">
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-full border-[rgba(var(--ui-fg),0.06)] bg-[rgba(var(--ui-fg),0.02)] text-[14px] text-[rgba(var(--ui-fg),0.55)] rounded-md hover:border-[rgba(var(--ui-fg),0.12)] transition-colors mb-3">
        <SelectValue>{session ? session.name || "Unnamed" : "Select session…"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {sessions.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="text-[rgba(var(--ui-fg),0.65)]">{s.name || "Unnamed"}</span>
            <span className="text-[rgba(var(--ui-fg),0.25)] ml-2">
              {formatDateWithYear(s.startedAt)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {session && (
      <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-[13px] font-mono tabular-nums">
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Date</div>
          <div className="text-[rgba(var(--ui-fg),0.45)]">
            {formatDateWithYear(session.startedAt)}
          </div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Duration</div>
          <div className="text-[rgba(var(--ui-fg),0.45)]">
            {session.durationSecs ? formatDuration(session.durationSecs) : "\u2014"}
          </div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Flows</div>
          <div className="text-[rgba(var(--ui-fg),0.45)]">
            {session.totalFlows.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Up</div>
          <div className="text-(--accent-orange)/50">{formatDataSize(session.totalBytesUp)}</div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Down</div>
          <div className="text-(--accent-cyan)/50">{formatDataSize(session.totalBytesDown)}</div>
        </div>
        <div>
          <div className="text-[rgba(var(--ui-fg),0.2)] text-[11px] mb-0.5">Latency</div>
          <div className="text-[rgba(var(--ui-fg),0.45)]">
            {session.avgLatencyMs > 0 ? `${session.avgLatencyMs.toFixed(0)}ms` : "\u2014"}
          </div>
        </div>
      </div>
    )}
  </div>
);
