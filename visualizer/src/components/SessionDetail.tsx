import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  ArrowLeft,
  Activity,
  Globe,
  Cpu,
  Pencil,
  Check,
  FileText,
  FileJson,
  BarChart3,
  Play,
  AlertTriangle,
  Tag,
  Plus,
  X,
  Info,
} from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import {
  getSession,
  getSessionFrames,
  getSessionFlows,
  getSessionDestinations,
  getProcessUsage,
  updateSessionMeta,
  exportSessionCsv,
  exportSessionJson,
  getPlaybackData,
  getSessionInsights,
  detectAnomalies,
  updateSessionTags,
  type SessionInfo,
  type FrameRecord,
  type FlowSnapshotRecord,
  type DestinationRecord,
  type ProcessUsageRecord,
  type SessionInsights,
  type Anomaly,
} from "../telemetry/sessions";
import { UPlotChart, type SeriesConfig } from "./UPlotChart";
import type uPlot from "uplot";
import {
  formatDataSize,
  formatDuration,
  formatTimestamp,
  formatRelativeTime,
  bpsToMbps,
  safeSum,
} from "../lib/utils";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { toast } from "sonner";

type Tab = "overview" | "destinations" | "processes";

const BAR_COLORS = [
  "var(--accent-cyan)",
  "var(--accent-orange)",
  "var(--accent-purple)",
  "var(--accent-green)",
  "var(--accent-amber)",
  "var(--accent-red)",
];

export const SessionDetail: React.FC = () => {
  const selectedSessionId = useTelemetryStore((s) => s.selectedSessionId);
  const selectedSession = useTelemetryStore((s) => s.selectedSession);
  const setView = useTelemetryStore((s) => s.setView);
  const selectSession = useTelemetryStore((s) => s.selectSession);
  const startPlayback = useTelemetryStore((s) => s.startPlayback);

  const [session, setSession] = useState<SessionInfo | null>(selectedSession);
  const [frames, setFrames] = useState<FrameRecord[]>([]);
  const [flows, setFlows] = useState<FlowSnapshotRecord[]>([]);
  const [destinations, setDestinations] = useState<DestinationRecord[]>([]);
  const [processes, setProcesses] = useState<ProcessUsageRecord[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<SessionInsights | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [exporting, setExporting] = useState(false);

  // Fetch session data
  useEffect(() => {
    if (!selectedSessionId) return;
    setError(null);
    // Reset stale state from previous session
    setAnomalies([]);
    setTags([]);
    setTagInput("");
    setInsights(null);
    let active = true;

    const load = async () => {
      try {
        const [s, fr, fl, ds, pr] = await Promise.all([
          getSession(selectedSessionId),
          getSessionFrames(selectedSessionId, { maxPoints: 500 }),
          getSessionFlows(selectedSessionId, { limit: 5000 }),
          getSessionDestinations(selectedSessionId, { limit: 50 }),
          getProcessUsage(selectedSessionId, { limit: 500 }),
        ]);
        if (!active) return;
        if (s) setSession(s);
        setFrames(fr);
        setFlows(fl);
        setDestinations(ds);
        setProcesses(pr);

        // Fetch insights (non-blocking, ok to fail)
        getSessionInsights(selectedSessionId)
          .then((ins) => {
            if (active) setInsights(ins);
          })
          .catch(() => {});

        // Fetch anomalies (non-blocking)
        detectAnomalies(selectedSessionId)
          .then((a) => {
            if (active) setAnomalies(a);
          })
          .catch(() => {});

        // Parse tags from session
        if (s) {
          try {
            const parsed = JSON.parse(s.tags || "[]");
            if (Array.isArray(parsed)) setTags(parsed);
          } catch {
            setTags([]);
          }
        }
      } catch (e) {
        if (!active) return;
        console.error("[SessionDetail] Failed to load session data:", e);
        setError(String(e));
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [selectedSessionId]);

  const handleBack = () => {
    selectSession(null);
    setView("live");
  };

  const handleSaveName = async () => {
    if (!selectedSessionId || !nameInput.trim()) {
      setEditingName(false);
      return;
    }
    try {
      await updateSessionMeta(selectedSessionId, { name: nameInput.trim() });
      setSession((prev) => (prev ? { ...prev, name: nameInput.trim() } : prev));
    } catch (e) {
      console.error("[SessionDetail] Failed to update name:", e);
    }
    setEditingName(false);
  };

  const handleExport = useCallback(
    async (format: "csv" | "json") => {
      if (!selectedSessionId || !session) return;
      setExporting(true);
      try {
        // Build a default filename with timestamp
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const safeName = session.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const filename = `abyss_${safeName}_${ts}.${format}`;

        // Use the Downloads folder or fallback to temp
        const { downloadDir, tempDir } = await import("@tauri-apps/api/path");
        let dir: string;
        try {
          dir = await downloadDir();
        } catch {
          try {
            dir = await tempDir();
          } catch {
            throw new Error("Cannot resolve a writable directory for export");
          }
        }
        const sep = dir.endsWith("\\") || dir.endsWith("/") ? "" : "\\";
        const path = `${dir}${sep}${filename}`;

        const msg =
          format === "csv"
            ? await exportSessionCsv(selectedSessionId, path)
            : await exportSessionJson(selectedSessionId, path);

        toast.success(msg);
      } catch (e) {
        toast.error(`Export failed: ${e}`);
      } finally {
        setExporting(false);
      }
    },
    [selectedSessionId, session],
  );

  const handlePlay = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      const data = await getPlaybackData(selectedSessionId);
      if (data.frames.length === 0) {
        toast.info("No frames to play back");
        return;
      }
      startPlayback(data);
    } catch (e) {
      toast.error(`Playback failed: ${e}`);
    }
  }, [selectedSessionId, startPlayback]);

  if (!session) {
    return (
      <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)]">
        {error ? (
          <div className="flex items-center justify-center w-full h-full">
            <span className="text-[13px] text-(--accent-red)">
              Error: {error}
            </span>
          </div>
        ) : (
          <div
            className="max-w-5xl mx-auto"
            style={{ padding: "60px 24px 40px" }}
          >
            <Skeleton className="h-5 w-24 mb-6" />
            <Skeleton className="h-7 w-64 mb-2" />
            <Skeleton className="h-4 w-40 mb-8" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-8 w-72 mb-6" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-[rgba(var(--ui-bg),0.95)] overflow-y-auto">
      <div className="max-w-5xl mx-auto" style={{ padding: "96px 48px 56px" }}>
        {/* Back + Export row */}
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[12px] text-[rgba(var(--ui-fg),0.4)] hover:text-[rgba(var(--ui-fg),0.7)]"
            onClick={handleBack}
          >
            <ArrowLeft size={13} />
            <span>Back to live</span>
          </Button>

          {/* Export & play buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-[11px] text-(--accent-cyan) hover:brightness-125"
              onClick={handlePlay}
              title="Replay this session on the map"
            >
              <Play size={12} />
              Replay
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-[11px] text-[rgba(var(--ui-fg),0.35)] hover:text-[rgba(var(--ui-fg),0.6)]"
              onClick={() => handleExport("csv")}
              disabled={exporting}
              title="Export as CSV"
            >
              <FileText size={12} />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-[11px] text-[rgba(var(--ui-fg),0.35)] hover:text-[rgba(var(--ui-fg),0.6)]"
              onClick={() => handleExport("json")}
              disabled={exporting}
              title="Export as JSON"
            >
              <FileJson size={12} />
              JSON
            </Button>
          </div>
        </div>

        {/* Session header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  className="bg-transparent border-b border-[rgba(var(--ui-fg),0.2)] text-[20px] font-bold text-[rgba(var(--ui-fg),0.9)] outline-none"
                  style={{ padding: "2px 0" }}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  autoFocus
                />
                <button
                  className="text-(--accent-green) hover:text-(--accent-green)/80"
                  onClick={handleSaveName}
                  aria-label="Save name"
                >
                  <Check size={16} />
                </button>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 group cursor-pointer"
                onClick={() => {
                  setNameInput(session.name);
                  setEditingName(true);
                }}
              >
                <h1 className="text-[20px] font-bold text-[rgba(var(--ui-fg),0.9)] group-hover:underline group-hover:underline-offset-4 group-hover:decoration-[rgba(var(--ui-fg),0.15)] transition-all duration-150">
                  {session.name}
                </h1>
                <button
                  className="text-[rgba(var(--ui-fg),0.15)] group-hover:text-[rgba(var(--ui-fg),0.5)] transition-colors duration-150"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNameInput(session.name);
                    setEditingName(true);
                  }}
                  aria-label="Edit session name"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[rgba(var(--ui-fg),0.35)] font-mono tabular-nums">
            <span>{formatTimestamp(session.startedAt)}</span>
            <span className="text-[rgba(var(--ui-fg),0.2)]">
              {formatRelativeTime(session.startedAt)}
            </span>
            {session.endedAt && (
              <>
                <span className="text-[rgba(var(--ui-fg),0.15)]">&rarr;</span>
                <span>{formatTimestamp(session.endedAt)}</span>
              </>
            )}
            <span className="text-[rgba(var(--ui-fg),0.15)]">·</span>
            <span>{formatDuration(session.durationSecs)}</span>
            {session.localCity && (
              <>
                <span className="text-[rgba(var(--ui-fg),0.15)]">·</span>
                <span>
                  {session.localCity}, {session.localCountry}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <SummaryCards session={session} />

        {/* Tab bar */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="mt-8 mb-6"
        >
          <TabsList className="bg-transparent p-0 gap-0 border-b border-[rgba(var(--ui-fg),0.06)] rounded-none w-full justify-start">
            <TabsTrigger
              value="overview"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-(--accent-cyan) data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-[rgba(var(--ui-fg),0.8)] text-[rgba(var(--ui-fg),0.3)] text-[11px] font-semibold tracking-[0.5px] uppercase px-3.5 py-2"
            >
              <Activity size={11} className="mr-1.5 -mt-px" />
              overview
            </TabsTrigger>
            <TabsTrigger
              value="destinations"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-(--accent-cyan) data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-[rgba(var(--ui-fg),0.8)] text-[rgba(var(--ui-fg),0.3)] text-[11px] font-semibold tracking-[0.5px] uppercase px-3.5 py-2"
            >
              <Globe size={11} className="mr-1.5 -mt-px" />
              destinations
            </TabsTrigger>
            <TabsTrigger
              value="processes"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-(--accent-cyan) data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-[rgba(var(--ui-fg),0.8)] text-[rgba(var(--ui-fg),0.3)] text-[11px] font-semibold tracking-[0.5px] uppercase px-3.5 py-2"
            >
              <Cpu size={11} className="mr-1.5 -mt-px" />
              processes
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Tab content */}
        {tab === "overview" && (
          <div className="tab-content-enter" key="overview">
            {/* Section navigation sidebar TOC */}
            <SectionToc
              hasInsights={!!insights}
              hasAnomalies={anomalies.length > 0}
            />
            <OverviewTab frames={frames} flows={flows} />
            {insights && <InsightsPanel insights={insights} />}
            {anomalies.length > 0 && <AnomalyPanel anomalies={anomalies} />}
            <TagsEditor
              tags={tags}
              tagInput={tagInput}
              setTagInput={setTagInput}
              onAdd={(tag) => {
                const trimmed = tag.slice(0, 50); // max 50 chars per tag
                if (
                  !selectedSessionId ||
                  tags.includes(trimmed) ||
                  tags.length >= 20
                )
                  return;
                const next = [...tags, trimmed];
                setTags(next);
                updateSessionTags(selectedSessionId, next).catch(() => {
                  setTags(tags); // revert on failure
                });
              }}
              onRemove={(tag) => {
                if (!selectedSessionId) return;
                const next = tags.filter((t) => t !== tag);
                setTags(next);
                updateSessionTags(selectedSessionId, next).catch(() => {
                  setTags(tags); // revert on failure
                });
              }}
            />
          </div>
        )}
        {tab === "destinations" && (
          <div className="tab-content-enter" key="destinations">
            <DestinationsTab destinations={destinations} />
          </div>
        )}
        {tab === "processes" && (
          <div className="tab-content-enter" key="processes">
            <ProcessesTab processes={processes} />
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Summary cards ────────────────────────────────────────────────────────

const SummaryCards: React.FC<{ session: SessionInfo }> = ({ session }) => {
  const totalUp = Number.isFinite(session.totalBytesUp)
    ? session.totalBytesUp
    : 0;
  const totalDown = Number.isFinite(session.totalBytesDown)
    ? session.totalBytesDown
    : 0;
  const totalBytes = totalUp + totalDown;
  const peakBps = Number.isFinite(session.peakBps) ? session.peakBps : 0;
  const avgLat = Number.isFinite(session.avgLatencyMs)
    ? session.avgLatencyMs
    : 0;
  const totalFlows = Number.isFinite(session.totalFlows)
    ? session.totalFlows
    : 0;
  const peakFlows = Number.isFinite(session.peakFlows) ? session.peakFlows : 0;

  const cards = [
    {
      label: "Total Transfer",
      value: formatDataSize(totalBytes),
      sub: `↑ ${formatDataSize(totalUp)} / ↓ ${formatDataSize(totalDown)}`,
    },
    {
      label: "Peak Throughput",
      value: `${bpsToMbps(peakBps).toFixed(1)} Mbps`,
    },
    {
      label: "Total Flows",
      value: totalFlows.toLocaleString(),
      sub: `Peak: ${peakFlows}`,
    },
    {
      label: "Avg Latency",
      value: `${avgLat.toFixed(1)} ms`,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-[rgba(var(--ui-fg),0.02)] border border-[rgba(var(--ui-fg),0.05)] rounded-xl"
          style={{ padding: "14px 16px" }}
        >
          <span className="text-[9px] font-semibold tracking-[1.2px] uppercase text-[rgba(var(--ui-fg),0.25)] block mb-1">
            {card.label}
          </span>
          <span className="text-[16px] font-bold text-[rgba(var(--ui-fg),0.85)] font-mono tabular-nums block">
            {card.value}
          </span>
          {card.sub && (
            <span className="text-[10px] text-[rgba(var(--ui-fg),0.3)] block mt-0.5">
              {card.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// ─── Overview tab ───────────────────────────────────────────────────────

const OverviewTab: React.FC<{
  frames: FrameRecord[];
  flows: FlowSnapshotRecord[];
}> = ({ frames, flows }) => {
  if (frames.length === 0) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)]">
          No frame data recorded
        </span>
      </div>
    );
  }

  // ── Throughput chart data (upload + download + total) ──
  const throughputData = useMemo((): uPlot.AlignedData => {
    const ts = new Float64Array(frames.length);
    const upload = new Float64Array(frames.length);
    const download = new Float64Array(frames.length);
    const total = new Float64Array(frames.length);

    const baseT = frames[0]?.t ?? 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      ts[i] = f.t - baseT; // elapsed seconds
      upload[i] = bpsToMbps(f.uploadBps);
      download[i] = bpsToMbps(f.downloadBps);
      total[i] = bpsToMbps(f.bps);
    }
    return [ts, total, upload, download];
  }, [frames]);

  const throughputSeries: SeriesConfig[] = useMemo(
    () => [
      { label: "Total", color: "cyan", unit: "Mbps", fill: true, width: 1.5 },
      {
        label: "Upload",
        color: "orange",
        unit: "Mbps",
        fill: false,
        width: 1,
      },
      {
        label: "Download",
        color: "green",
        unit: "Mbps",
        fill: false,
        width: 1,
      },
    ],
    [],
  );

  // ── Latency chart data ──
  const latencyData = useMemo((): uPlot.AlignedData => {
    const ts = new Float64Array(frames.length);
    const lat = new Float64Array(frames.length);
    const baseT = frames[0]?.t ?? 0;
    for (let i = 0; i < frames.length; i++) {
      ts[i] = frames[i].t - baseT;
      lat[i] = Number.isFinite(frames[i].latencyMs) ? frames[i].latencyMs : 0;
    }
    return [ts, lat];
  }, [frames]);

  const latencySeries: SeriesConfig[] = useMemo(
    () => [{ label: "Latency", color: "amber", unit: "ms", fill: true }],
    [],
  );

  // ── Active flows chart data ──
  const flowsData = useMemo((): uPlot.AlignedData => {
    const ts = new Float64Array(frames.length);
    const fl = new Float64Array(frames.length);
    const baseT = frames[0]?.t ?? 0;
    for (let i = 0; i < frames.length; i++) {
      ts[i] = frames[i].t - baseT;
      fl[i] = frames[i].activeFlows;
    }
    return [ts, fl];
  }, [frames]);

  const flowsSeries: SeriesConfig[] = useMemo(
    () => [{ label: "Active Flows", color: "green", unit: "", fill: true }],
    [],
  );

  // ── Protocol distribution ──
  const protocolBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of flows) {
      const proto = f.protocol ?? "unknown";
      const bps = Number.isFinite(f.bps) ? f.bps : 0;
      counts[proto] = (counts[proto] || 0) + bps;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(counts)
      .map(([name, bps]) => ({
        name: name.toUpperCase(),
        bps,
        pct: (bps / total) * 100,
      }))
      .sort((a, b) => b.bps - a.bps);
  }, [flows]);

  // ── Service distribution ──
  const serviceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of flows) {
      const svc = f.service ?? "Other";
      const bps = Number.isFinite(f.bps) ? f.bps : 0;
      counts[svc] = (counts[svc] || 0) + bps;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(counts)
      .map(([name, bps]) => ({ name, bps, pct: (bps / total) * 100 }))
      .sort((a, b) => b.bps - a.bps)
      .slice(0, 8);
  }, [flows]);

  return (
    <div className="flex flex-col gap-6">
      {/* Throughput timeline */}
      <ChartCard label="Throughput over Time" id="section-throughput">
        <UPlotChart
          data={throughputData}
          series={throughputSeries}
          height={220}
          yFormat={(v) =>
            v >= 1000 ? `${(v / 1000).toFixed(1)}G` : `${v.toFixed(1)}`
          }
        />
      </ChartCard>

      {/* Latency timeline */}
      <ChartCard label="Latency over Time" id="section-latency">
        <UPlotChart
          data={latencyData}
          series={latencySeries}
          height={160}
          yFormat={(v) =>
            v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`
          }
        />
      </ChartCard>

      {/* Active flows timeline */}
      <ChartCard label="Active Flows over Time" id="section-flows">
        <UPlotChart data={flowsData} series={flowsSeries} height={140} />
      </ChartCard>

      {/* Protocol & Service breakdown side by side */}
      <div
        id="section-protocols"
        className="grid grid-cols-1 md:grid-cols-2 gap-6"
      >
        {/* Protocol distribution */}
        <div
          className="bg-[rgba(var(--ui-fg),0.02)] border border-[rgba(var(--ui-fg),0.05)] rounded-xl"
          style={{ padding: "16px" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={12} className="text-[rgba(var(--ui-fg),0.3)]" />
            <span className="text-[10px] font-semibold tracking-[1px] uppercase text-[rgba(var(--ui-fg),0.3)]">
              Protocol Distribution
            </span>
          </div>
          {protocolBreakdown.length === 0 ? (
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.2)]">
              No data
            </span>
          ) : (
            <div className="flex flex-col gap-2">
              {protocolBreakdown.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono font-medium text-[rgba(var(--ui-fg),0.6)] w-12 shrink-0">
                    {p.name}
                  </span>
                  <div className="flex-1 h-3.5 bg-[rgba(var(--ui-fg),0.03)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(p.pct, 1)}%`,
                        background: BAR_COLORS[i % BAR_COLORS.length],
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.4)] w-10 text-right shrink-0">
                    {p.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Service distribution */}
        <div
          className="bg-[rgba(var(--ui-fg),0.02)] border border-[rgba(var(--ui-fg),0.05)] rounded-xl"
          style={{ padding: "16px" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Globe size={12} className="text-[rgba(var(--ui-fg),0.3)]" />
            <span className="text-[10px] font-semibold tracking-[1px] uppercase text-[rgba(var(--ui-fg),0.3)]">
              Service Breakdown
            </span>
          </div>
          {serviceBreakdown.length === 0 ? (
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.2)]">
              No data
            </span>
          ) : (
            <div className="flex flex-col gap-2">
              {serviceBreakdown.map((s, i) => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono font-medium text-[rgba(var(--ui-fg),0.6)] w-16 shrink-0 truncate">
                    {s.name}
                  </span>
                  <div className="flex-1 h-3.5 bg-[rgba(var(--ui-fg),0.03)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(s.pct, 1)}%`,
                        background: BAR_COLORS[(i + 2) % BAR_COLORS.length],
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.4)] w-10 text-right shrink-0">
                    {s.pct.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Chart card wrapper ─────────────────────────────────────────────────

const ChartCard: React.FC<{
  label: string;
  id?: string;
  children: React.ReactNode;
}> = ({ label, id, children }) => (
  <div
    id={id}
    className="chart-draw-in bg-[rgba(var(--ui-fg),0.02)] border border-[rgba(var(--ui-fg),0.05)] rounded-xl scroll-mt-20"
    style={{ padding: "16px" }}
  >
    <span className="text-[10px] font-semibold tracking-[1px] uppercase text-[rgba(var(--ui-fg),0.3)] block mb-3">
      {label}
    </span>
    {children}
  </div>
);

// ─── Destinations tab ───────────────────────────────────────────────────

const DestinationsTab: React.FC<{ destinations: DestinationRecord[] }> = ({
  destinations,
}) => {
  if (destinations.length === 0) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)]">
          No destination data
        </span>
      </div>
    );
  }

  const maxBytes = Math.max(...destinations.map((d) => d.totalBytes), 1);

  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div
        className="grid grid-cols-[1fr_80px_60px_80px] text-[9px] font-semibold tracking-[1px] uppercase text-[rgba(var(--ui-fg),0.25)]"
        style={{ padding: "6px 14px" }}
      >
        <span>Destination</span>
        <span className="text-right">Bytes</span>
        <span className="text-right">Conns</span>
        <span className="text-right">Service</span>
      </div>

      {destinations.map((dest) => (
        <div
          key={dest.ip}
          className="relative grid grid-cols-[1fr_80px_60px_80px] items-center rounded-lg hover:bg-[rgba(var(--ui-fg),0.03)] transition-colors duration-100"
          style={{ padding: "8px 14px" }}
        >
          {/* Bar background */}
          <div
            className="absolute inset-y-0 left-0 rounded-lg bg-(--accent-cyan) opacity-[0.03]"
            style={{
              width: `${(dest.totalBytes / maxBytes) * 100}%`,
            }}
          />
          <div className="flex flex-col gap-0.5 min-w-0 relative">
            <span className="text-[11px] font-medium text-[rgba(var(--ui-fg),0.7)] truncate font-mono">
              {dest.ip}
            </span>
            <span className="text-[10px] text-[rgba(var(--ui-fg),0.3)] truncate">
              {[dest.city, dest.country].filter(Boolean).join(", ") || "—"}
              {dest.org && ` · ${dest.org}`}
            </span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.5)] text-right relative">
            {formatDataSize(dest.totalBytes)}
          </span>
          <span className="text-[11px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.4)] text-right relative">
            {dest.connectionCount}
          </span>
          <span className="text-[10px] text-[rgba(var(--ui-fg),0.35)] text-right relative">
            {dest.primaryService || "—"}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Processes tab ──────────────────────────────────────────────────────

const ProcessesTab: React.FC<{ processes: ProcessUsageRecord[] }> = ({
  processes,
}) => {
  // Aggregate by process name (records come in time-series, we want summary)
  const aggregated = useMemo(() => {
    const map = new Map<
      string,
      {
        bytesUp: number;
        bytesDown: number;
        flowCount: number;
        rttSum: number;
        samples: number;
      }
    >();
    for (const p of processes) {
      const existing = map.get(p.processName) ?? {
        bytesUp: 0,
        bytesDown: 0,
        flowCount: 0,
        rttSum: 0,
        samples: 0,
      };
      existing.bytesUp += p.bytesUp;
      existing.bytesDown += p.bytesDown;
      existing.flowCount += p.flowCount;
      existing.rttSum += p.avgRtt;
      existing.samples += 1;
      map.set(p.processName, existing);
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        bytesUp: data.bytesUp,
        bytesDown: data.bytesDown,
        totalBytes: data.bytesUp + data.bytesDown,
        flowCount: data.flowCount,
        avgRtt: data.samples > 0 ? data.rttSum / data.samples : 0,
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes);
  }, [processes]);

  // Build per-process timeline data for the top 5 processes
  const processTimeline = useMemo(() => {
    if (processes.length === 0) return null;

    // Get top 5 by total bytes
    const topNames = aggregated.slice(0, 5).map((p) => p.name);
    if (topNames.length === 0) return null;

    // Group records by timestamp, sorted
    const byTime = new Map<string, Map<string, number>>();
    for (const p of processes) {
      if (!topNames.includes(p.processName)) continue;
      let timeMap = byTime.get(p.timestamp);
      if (!timeMap) {
        timeMap = new Map();
        byTime.set(p.timestamp, timeMap);
      }
      timeMap.set(
        p.processName,
        (timeMap.get(p.processName) ?? 0) + p.bytesUp + p.bytesDown,
      );
    }

    const sortedTimes = Array.from(byTime.keys()).sort();
    if (sortedTimes.length < 2) return null;

    // Build uPlot-compatible data
    const ts = new Float64Array(sortedTimes.length);
    const series: Float64Array[] = topNames.map(
      () => new Float64Array(sortedTimes.length),
    );

    const t0raw = new Date(sortedTimes[0]).getTime();
    const t0 = Number.isFinite(t0raw) ? t0raw / 1000 : 0;
    for (let i = 0; i < sortedTimes.length; i++) {
      const tRaw = new Date(sortedTimes[i]).getTime();
      ts[i] = Number.isFinite(tRaw) ? tRaw / 1000 - t0 : 0;
      const timeMap = byTime.get(sortedTimes[i])!;
      for (let j = 0; j < topNames.length; j++) {
        const bytes = timeMap.get(topNames[j]) ?? 0;
        series[j][i] = bytes / (1024 * 1024); // Convert to MB
      }
    }

    const data: uPlot.AlignedData = [ts, ...series];

    const seriesColors = [
      "cyan",
      "orange",
      "purple",
      "green",
      "amber",
    ] as const;
    const seriesConfig: SeriesConfig[] = topNames.map((name, i) => ({
      label: name.replace(/\.exe$/i, ""),
      color: seriesColors[i % seriesColors.length],
      unit: "MB",
      fill: true,
      width: 1.5,
    }));

    return { data, series: seriesConfig };
  }, [processes, aggregated]);

  if (aggregated.length === 0) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="text-[11px] text-[rgba(var(--ui-fg),0.3)]">
          No process data recorded
        </span>
      </div>
    );
  }

  const maxBytes = Math.max(...aggregated.map((p) => p.totalBytes), 1);

  return (
    <div className="flex flex-col gap-6">
      {/* Process usage timeline chart */}
      {processTimeline && (
        <ChartCard label="Top Processes over Time">
          <UPlotChart
            data={processTimeline.data}
            series={processTimeline.series}
            height={180}
            yFormat={(v) =>
              v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v.toFixed(0)} MB`
            }
          />
        </ChartCard>
      )}

      {/* Process table */}
      <div className="flex flex-col gap-1">
        {/* Header */}
        <div
          className="grid grid-cols-[1fr_80px_80px_60px_60px] text-[9px] font-semibold tracking-[1px] uppercase text-[rgba(var(--ui-fg),0.25)]"
          style={{ padding: "6px 14px" }}
        >
          <span>Process</span>
          <span className="text-right">Upload</span>
          <span className="text-right">Download</span>
          <span className="text-right">Flows</span>
          <span className="text-right">RTT</span>
        </div>

        {aggregated.map((proc) => (
          <div
            key={proc.name}
            className="relative grid grid-cols-[1fr_80px_80px_60px_60px] items-center rounded-lg hover:bg-[rgba(var(--ui-fg),0.03)] transition-colors duration-100"
            style={{ padding: "10px 14px" }}
          >
            {/* Bar background */}
            <div
              className="absolute inset-y-0 left-0 rounded-lg bg-(--accent-purple) opacity-[0.04]"
              style={{
                width: `${(proc.totalBytes / maxBytes) * 100}%`,
              }}
            />
            <span className="text-[11px] font-medium text-[rgba(var(--ui-fg),0.7)] truncate relative">
              {proc.name}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-(--accent-orange) text-right relative">
              {formatDataSize(proc.bytesUp)}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-(--accent-cyan) text-right relative">
              {formatDataSize(proc.bytesDown)}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.4)] text-right relative">
              {proc.flowCount}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.4)] text-right relative">
              {Number.isFinite(proc.avgRtt) ? proc.avgRtt.toFixed(0) : "—"}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Section Navigation TOC ──────────────────────────────────────────────────

const TOC_SECTIONS = [
  { id: "section-throughput", label: "Throughput" },
  { id: "section-latency", label: "Latency" },
  { id: "section-flows", label: "Flows" },
  { id: "section-protocols", label: "Protocols" },
] as const;

const SectionToc: React.FC<{
  hasInsights: boolean;
  hasAnomalies: boolean;
}> = ({ hasInsights, hasAnomalies }) => {
  const [activeId, setActiveId] = useState<string>("");

  const sections = useMemo(() => {
    const list = [...TOC_SECTIONS] as { id: string; label: string }[];
    if (hasInsights) list.push({ id: "section-insights", label: "Insights" });
    if (hasAnomalies)
      list.push({ id: "section-anomalies", label: "Anomalies" });
    list.push({ id: "section-tags", label: "Tags" });
    return list;
  }, [hasInsights, hasAnomalies]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first section currently intersecting
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav
      aria-label="Section navigation"
      className="fixed right-6 top-1/2 -translate-y-1/2 z-10 hidden xl:flex flex-col gap-1 py-2 px-1.5 rounded-xl bg-[rgba(var(--ui-bg),0.6)] backdrop-blur-md border border-[rgba(var(--ui-fg),0.06)]"
    >
      {sections.map((s) => (
        <button
          key={s.id}
          onClick={() => handleClick(s.id)}
          className={`text-[9px] font-medium px-2 py-1 rounded-md text-left transition-colors whitespace-nowrap ${
            activeId === s.id
              ? "text-(--accent-cyan) bg-(--accent-cyan)/10"
              : "text-[rgba(var(--ui-fg),0.3)] hover:text-[rgba(var(--ui-fg),0.6)] hover:bg-[rgba(var(--ui-fg),0.04)]"
          }`}
          title={s.label}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
};

// ─── Insights Panel ──────────────────────────────────────────────────────────

const InsightsPanel: React.FC<{ insights: SessionInsights }> = ({
  insights,
}) => (
  <div id="section-insights" className="mt-6 scroll-mt-20">
    <h3 className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.6)] mb-3">
      Session Insights
    </h3>
    <div
      className="rounded-xl border border-[rgba(var(--ui-fg),0.06)] bg-[rgba(var(--ui-fg),0.02)] space-y-3"
      style={{ padding: "16px 18px" }}
    >
      <InsightRow
        label="Total Data"
        value={insights.totalDataHuman}
        tip="Combined upload and download bytes for this session"
      />
      {insights.busiestMinute && (
        <InsightRow
          label="Peak Activity"
          value={insights.busiestMinute}
          tip="The minute with the highest throughput"
        />
      )}
      <InsightRow
        label="Top Process"
        value={insights.mostActiveProcess}
        tip="Process that generated the most network traffic"
      />
      <InsightRow
        label="Unique Destinations"
        value={String(insights.uniqueDestinations)}
        tip="Number of distinct IP addresses contacted"
      />
      <InsightRow
        label="Countries Reached"
        value={String(insights.uniqueCountries)}
        tip="Number of distinct countries based on GeoIP lookup"
      />
      {insights.topServices.length > 0 && (
        <InsightRow
          label="Top Services"
          value={insights.topServices.join(", ")}
          tip="Most frequently used application-layer services"
        />
      )}
      {insights.highLatencyDestinations.length > 0 && (
        <InsightRow
          label="High Latency (>200ms)"
          value={insights.highLatencyDestinations.slice(0, 5).join(", ")}
          warn
          tip="Destinations with round-trip time exceeding 200ms"
        />
      )}
      {insights.unusualPorts.length > 0 && (
        <InsightRow
          label="Unusual Ports"
          value={insights.unusualPorts.slice(0, 10).join(", ")}
          warn
          tip="Ports outside the common range that may indicate non-standard services"
        />
      )}
      {insights.longestConnection && (
        <InsightRow
          label="Longest Connection"
          value={`${insights.longestConnection.dstIp}${insights.longestConnection.service ? ` (${insights.longestConnection.service})` : ""} — ${formatDuration(insights.longestConnection.durationSecs)}`}
          tip="The connection that stayed open the longest"
        />
      )}
    </div>
  </div>
);

const InsightRow: React.FC<{
  label: string;
  value: string;
  warn?: boolean;
  tip?: string;
}> = ({ label, value, warn, tip }) => (
  <div className="flex items-start justify-between gap-4">
    <span className="text-[11px] text-[rgba(var(--ui-fg),0.35)] shrink-0 flex items-center gap-1">
      {label}
      {tip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info
              size={10}
              className="text-[rgba(var(--ui-fg),0.2)] hover:text-[rgba(var(--ui-fg),0.4)] cursor-help transition-colors"
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-52 text-[10px]">
            {tip}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
    <span
      className={`text-[11px] font-mono text-right truncate ${
        warn ? "text-(--accent-amber)" : "text-[rgba(var(--ui-fg),0.6)]"
      }`}
    >
      {value}
    </span>
  </div>
);

/* ── Anomaly Panel ───────────────────────────────────────────────────────── */

const severityColor: Record<string, string> = {
  high: "var(--accent-red)",
  medium: "var(--accent-orange)",
  low: "var(--accent-amber)",
};

const AnomalyPanel: React.FC<{ anomalies: Anomaly[] }> = ({ anomalies }) => (
  <div
    id="section-anomalies"
    style={{ padding: "14px 16px", marginTop: 12 }}
    className="bg-[rgba(var(--ui-fg),0.02)] rounded-xl border border-[rgba(var(--ui-fg),0.06)] scroll-mt-20"
  >
    <div className="flex items-center gap-1.5 mb-3">
      <AlertTriangle size={13} className="text-(--accent-amber)" />
      <span className="text-[11px] font-semibold tracking-[1px] uppercase text-[rgba(var(--ui-fg),0.4)]">
        Anomalies ({anomalies.length})
      </span>
    </div>
    <div className="flex flex-col gap-2">
      {anomalies.map((a, i) => (
        <div
          key={i}
          style={{ padding: "8px 12px" }}
          className="flex items-start gap-2.5 bg-[rgba(var(--ui-fg),0.02)] rounded-lg border border-[rgba(var(--ui-fg),0.04)]"
        >
          <span
            className="inline-block w-2 h-2 rounded-full mt-1 shrink-0"
            style={{
              backgroundColor:
                severityColor[a.severity] || "var(--accent-amber)",
            }}
          />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] font-semibold text-[rgba(var(--ui-fg),0.75)]">
              {a.anomalyType
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase())}
              <span className="ml-1.5 text-[10px] font-normal text-[rgba(var(--ui-fg),0.35)]">
                {a.severity}
                {Number.isFinite(a.deviationSigmas) && a.deviationSigmas > 0
                  ? ` · ${a.deviationSigmas.toFixed(1)}σ`
                  : ""}
              </span>
            </span>
            <span className="text-[11px] text-[rgba(var(--ui-fg),0.5)] truncate">
              {a.message}
            </span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/* ── Tags Editor ─────────────────────────────────────────────────────────── */

const TagsEditor: React.FC<{
  tags: string[];
  tagInput: string;
  setTagInput: (v: string) => void;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}> = ({ tags, tagInput, setTagInput, onAdd, onRemove }) => {
  const TAG_MAX = 50;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key === "Enter" &&
      tagInput.trim() &&
      tagInput.trim().length <= TAG_MAX
    ) {
      onAdd(tagInput.trim());
      setTagInput("");
    }
  };

  return (
    <div
      id="section-tags"
      style={{ padding: "14px 16px", marginTop: 12 }}
      className="bg-[rgba(var(--ui-fg),0.02)] rounded-xl border border-[rgba(var(--ui-fg),0.06)] scroll-mt-20"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <Tag size={13} className="text-[rgba(var(--ui-fg),0.4)]" />
        <span className="text-[11px] font-semibold tracking-[1px] uppercase text-[rgba(var(--ui-fg),0.4)]">
          Tags
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            style={{ padding: "3px 8px" }}
            className="inline-flex items-center gap-1 bg-[rgba(var(--ui-fg),0.06)] rounded-md text-[11px] font-medium text-[rgba(var(--ui-fg),0.7)]"
          >
            {tag}
            <button
              className="text-[rgba(var(--ui-fg),0.35)] hover:text-[rgba(var(--ui-fg),0.7)] transition-colors cursor-pointer"
              onClick={() => onRemove(tag)}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <div className="inline-flex items-center gap-1">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value.slice(0, TAG_MAX))}
            onKeyDown={handleKeyDown}
            placeholder="Add tag..."
            maxLength={TAG_MAX}
            className="text-[11px] bg-transparent border-none outline-none text-[rgba(var(--ui-fg),0.6)] placeholder:text-[rgba(var(--ui-fg),0.2)]"
            style={{
              padding: "3px 4px",
              width: `${Math.min(Math.max(tagInput.length * 7 + 60, 80), 200)}px`,
              transition: "width 0.1s ease",
            }}
          />
          {tagInput.length > 0 && (
            <span
              className={`text-[9px] font-mono tabular-nums ${tagInput.length >= TAG_MAX ? "text-(--accent-red)" : "text-[rgba(var(--ui-fg),0.2)]"}`}
            >
              {tagInput.length}/{TAG_MAX}
            </span>
          )}
          {tagInput.trim() && tagInput.trim().length <= TAG_MAX && (
            <button
              className="text-[rgba(var(--ui-fg),0.4)] hover:text-(--accent-cyan) transition-colors cursor-pointer"
              onClick={() => {
                onAdd(tagInput.trim());
                setTagInput("");
              }}
            >
              <Plus size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
