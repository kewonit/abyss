import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Settings,
  Navigation,
  Clock,
  Circle,
  BarChart3,
  Database,
  Trash2,
  FolderOpen,
  Bell,
  AlertTriangle,
} from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import {
  getGlobalStats,
  cleanupSessions,
  cleanupExcessSessions,
  deleteAllSessions,
  getDatabasePath,
  openDataFolder,
  getHealthScore,
  detectAnomalies,
  type GlobalStats,
  type HealthScore,
  type Anomaly,
} from "../telemetry/sessions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { formatBitRate } from "../lib/utils";

export const TopBar: React.FC = () => {
  // Primitive selectors — only re-render when the actual number changes,
  // not on every frame when the parent object reference changes.
  const hasFrame = useTelemetryStore((s) => s.frame !== null);
  const bps = useTelemetryStore((s) => s.frame?.net.bps ?? 0);
  const uploadBps = useTelemetryStore((s) => s.frame?.net.uploadBps ?? 0);
  const downloadBps = useTelemetryStore((s) => s.frame?.net.downloadBps ?? 0);
  const latencyMs = useTelemetryStore((s) => s.frame?.net.latencyMs ?? 0);
  const recording = useTelemetryStore((s) => s.recording);
  const currentSessionId = useTelemetryStore((s) => s.currentSessionId);
  const toggleDrawer = useTelemetryStore((s) => s.toggleDrawer);
  const drawerOpen = useTelemetryStore((s) => s.drawerOpen);
  const view = useTelemetryStore((s) => s.view);
  const setView = useTelemetryStore((s) => s.setView);
  const [clock, setClock] = useState("");
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem("abyss:theme");
      if (saved === "light") return false;
      if (saved === "dark") return true;
      // Auto-detect from system preference
      return !window.matchMedia("(prefers-color-scheme: light)").matches;
    } catch {
      return true;
    }
  });

  // Listen for OS theme changes when no explicit user preference is saved
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem("abyss:theme");
      if (saved) return; // User chose explicitly, don't override
      setDarkMode(!e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  /* ── storage management state ── */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "general" | "storage" | "notifications" | "appearance"
  >("general");
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [dbPath, setDbPath] = useState("");
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try {
      return localStorage.getItem("abyss:notifications") === "true";
    } catch {
      return false;
    }
  });
  const lastNotifiedScoreRef = useRef<number | null>(null);
  const [liveAnomalies, setLiveAnomalies] = useState<Anomaly[]>([]);
  const [autoCleanupAge, setAutoCleanupAge] = useState(() => {
    try {
      const v = localStorage.getItem("abyss:autoCleanupAge");
      if (v) {
        const parsed = JSON.parse(v);
        if (
          typeof parsed?.enabled === "boolean" &&
          typeof parsed?.days === "number"
        ) {
          return parsed as { enabled: boolean; days: number };
        }
      }
    } catch {
      /* corrupted localStorage */
    }
    return { enabled: false, days: 30 };
  });
  const [autoCleanupMax, setAutoCleanupMax] = useState(() => {
    try {
      const v = localStorage.getItem("abyss:autoCleanupMax");
      if (v) {
        const parsed = JSON.parse(v);
        if (
          typeof parsed?.enabled === "boolean" &&
          typeof parsed?.count === "number"
        ) {
          return parsed as { enabled: boolean; count: number };
        }
      }
    } catch {
      /* corrupted localStorage */
    }
    return { enabled: false, count: 100 };
  });
  const [storageMsg, setStorageMsg] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const msgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* persist cleanup prefs */
  useEffect(() => {
    localStorage.setItem(
      "abyss:autoCleanupAge",
      JSON.stringify(autoCleanupAge),
    );
  }, [autoCleanupAge]);
  useEffect(() => {
    localStorage.setItem(
      "abyss:autoCleanupMax",
      JSON.stringify(autoCleanupMax),
    );
  }, [autoCleanupMax]);

  /* fetch stats when settings dialog opens */
  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, p] = await Promise.all([getGlobalStats(), getDatabasePath()]);
        if (!cancelled) {
          setStats(s);
          setDbPath(p);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  /* auto-cleanup on app mount */
  useEffect(() => {
    (async () => {
      try {
        if (autoCleanupAge.enabled && autoCleanupAge.days > 0) {
          await cleanupSessions(autoCleanupAge.days);
        }
        if (autoCleanupMax.enabled && autoCleanupMax.count > 0) {
          await cleanupExcessSessions(autoCleanupMax.count);
        }
      } catch {
        /* best effort */
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showStorageMsg = useCallback((msg: string) => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    setStorageMsg(msg);
    msgTimerRef.current = setTimeout(() => setStorageMsg(""), 3000);
  }, []);

  const handleDeleteAll = useCallback(async () => {
    if (storageBusy) return;
    setStorageBusy(true);
    try {
      const n = await deleteAllSessions();
      showStorageMsg(`Deleted ${n} session${n === 1 ? "" : "s"}`);
      const s = await getGlobalStats().catch(() => null);
      if (s) setStats(s);
    } catch {
      showStorageMsg("Failed to delete sessions");
    } finally {
      setStorageBusy(false);
    }
  }, [storageBusy, showStorageMsg]);

  const handleManualCleanup = useCallback(async () => {
    if (storageBusy) return;
    setStorageBusy(true);
    try {
      let total = 0;
      if (autoCleanupAge.enabled && autoCleanupAge.days > 0) {
        total += await cleanupSessions(autoCleanupAge.days);
      }
      if (autoCleanupMax.enabled && autoCleanupMax.count > 0) {
        total += await cleanupExcessSessions(autoCleanupMax.count);
      }
      showStorageMsg(`Cleaned up ${total} session${total === 1 ? "" : "s"}`);
      const s = await getGlobalStats().catch(() => null);
      if (s) setStats(s);
    } catch {
      showStorageMsg("Cleanup failed");
    } finally {
      setStorageBusy(false);
    }
  }, [autoCleanupAge, autoCleanupMax, storageBusy, showStorageMsg]);

  const handleOpenDataFolder = useCallback(async () => {
    try {
      await openDataFolder();
    } catch {
      /* best effort */
    }
  }, []);

  /* persist notification preference */
  useEffect(() => {
    localStorage.setItem("abyss:notifications", String(notificationsEnabled));
  }, [notificationsEnabled]);

  const handleToggleNotifications = useCallback(async (enabled: boolean) => {
    if (
      enabled &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return; // user denied
    }
    setNotificationsEnabled(enabled);
  }, []);

  const sendNotification = useCallback((title: string, body: string) => {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    } catch {
      /* ignore */
    }
  }, []);

  /* health score — fetch on mount and every 5 minutes */
  useEffect(() => {
    const fetchHealth = () => {
      getHealthScore(24)
        .then((hs) => {
          setHealthScore(hs);
          // Trigger notification if score dropped below threshold
          if (notificationsEnabled && hs && recording) {
            const prev = lastNotifiedScoreRef.current;
            if (hs.score < 40 && (prev === null || prev >= 40)) {
              sendNotification(
                "Network Health Alert",
                `Health score dropped to ${hs.score}/100. ${hs.details || "Check your network."}`,
              );
            }
            lastNotifiedScoreRef.current = hs.score;
          }
        })
        .catch(() => {});
    };
    const t = setTimeout(fetchHealth, 3000); // delay for DB init
    const iv = setInterval(fetchHealth, 5 * 60 * 1000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [notificationsEnabled, recording]);

  /* live anomaly detection — poll every 30s while recording */
  useEffect(() => {
    if (!recording || !currentSessionId) {
      setLiveAnomalies([]);
      return;
    }
    const fetchAnomalies = () => {
      detectAnomalies(currentSessionId)
        .then((a) => {
          setLiveAnomalies(a.filter((x) => x.severity !== "low"));
          // Send notification for high-severity anomalies
          if (notificationsEnabled) {
            const high = a.filter((x) => x.severity === "high");
            if (high.length > 0) {
              sendNotification(
                "Anomaly Detected",
                high.map((h) => h.message).join("; "),
              );
            }
          }
        })
        .catch(() => {});
    };
    const t = setTimeout(fetchAnomalies, 10_000); // initial delay
    const iv = setInterval(fetchAnomalies, 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [recording, currentSessionId, notificationsEnabled, sendNotification]);

  useEffect(() => {
    document.body.classList.toggle("light-mode", !darkMode);
    try {
      localStorage.setItem("abyss:theme", darkMode ? "dark" : "light");
    } catch {}
    window.dispatchEvent(
      new CustomEvent("abyss:theme-change", { detail: { darkMode } }),
    );
  }, [darkMode]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleNorthUp = () => {
    window.dispatchEvent(new CustomEvent("abyss:north-up"));
  };

  return (
    <>
      <div className="absolute top-4 left-4">
        <div className="inline-flex items-center rounded-lg border border-(--pill-border) bg-(--pill-bg) px-3 py-2 backdrop-blur-xl">
          <span className="font-sans text-[12px] font-bold tracking-[2px] text-[rgba(var(--ui-fg),0.88)]">
            ABYSS
          </span>
        </div>
      </div>

      {/* Top-right: recording indicator + sessions toggle */}
      <div className="absolute top-4 right-4 max-w-[calc(100vw-2rem)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex min-w-max items-center gap-2 rounded-xl border border-(--pill-border) bg-(--pill-bg) px-2 py-2 backdrop-blur-xl">
          {healthScore && healthScore.score > 0 && (
            <div
              className="flex h-8 items-center gap-2 rounded-lg border border-[rgba(var(--ui-fg),0.08)] bg-[rgba(var(--ui-fg),0.02)] px-2.5 max-[700px]:hidden cursor-default"
              title={healthScore.details}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor:
                    healthScore.score >= 80
                      ? "var(--accent-green)"
                      : healthScore.score >= 60
                        ? "var(--accent-amber)"
                        : healthScore.score >= 40
                          ? "var(--accent-orange)"
                          : "var(--accent-red)",
                }}
              />
              <span className="text-[11px] font-medium tracking-[0.2px] text-[rgba(var(--ui-fg),0.62)]">
                Health
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-[rgba(var(--ui-fg),0.88)]">
                {healthScore.score}
              </span>
            </div>
          )}

          {/* Live anomaly badge — visible during recording when medium/high anomalies are detected */}
          {recording && liveAnomalies.length > 0 && (
            <div
              className="flex h-8 items-center gap-2 rounded-lg border border-[rgba(255,180,50,0.18)] bg-[rgba(255,180,50,0.06)] px-2.5 max-[700px]:hidden cursor-default"
              title={liveAnomalies.map((a) => a.message).join("\n")}
            >
              <AlertTriangle size={12} className="text-(--accent-amber)" />
              <span className="text-[11px] font-medium tracking-[0.2px] text-(--accent-amber)">
                Alerts
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-(--accent-amber)">
                {liveAnomalies.length}
              </span>
            </div>
          )}

          {recording && (
            <div className="flex h-8 items-center gap-2 rounded-lg border border-[rgba(255,77,106,0.24)] bg-[rgba(255,77,106,0.08)] px-2.5 max-[560px]:hidden">
              <Circle
                size={6}
                fill="var(--accent-red)"
                className="text-(--accent-red) animate-pulse"
              />
              <span className="text-[11px] font-semibold tracking-[0.5px] uppercase text-(--accent-red)">
                REC
              </span>
            </div>
          )}

          <span className="mx-0.5 h-5 w-px shrink-0 bg-[rgba(var(--ui-fg),0.09)]" />

          {view !== "live" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg border-[rgba(var(--ui-fg),0.08)] bg-[rgba(var(--ui-fg),0.02)] px-3 text-[rgba(var(--ui-fg),0.68)] hover:bg-[rgba(var(--ui-fg),0.08)] hover:text-[rgba(var(--ui-fg),0.9)]"
                  onClick={() => setView("live")}
                >
                  <span className="text-[11px] font-medium tracking-[0.3px] uppercase">
                    Live
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to live view</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 rounded-lg border transition-colors ${
                  view === "analytics"
                    ? "bg-(--accent-cyan)/10 border-(--accent-cyan)/25 text-(--accent-cyan)"
                    : "bg-[rgba(var(--ui-fg),0.02)] border-[rgba(var(--ui-fg),0.08)] text-[rgba(var(--ui-fg),0.55)] hover:bg-[rgba(var(--ui-fg),0.08)] hover:text-[rgba(var(--ui-fg),0.9)]"
                }`}
                onClick={() => setView("analytics")}
              >
                <BarChart3 size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Analytics</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 rounded-lg border transition-colors ${
                  drawerOpen
                    ? "bg-(--accent-cyan)/10 border-(--accent-cyan)/25 text-(--accent-cyan)"
                    : "bg-[rgba(var(--ui-fg),0.02)] border-[rgba(var(--ui-fg),0.08)] text-[rgba(var(--ui-fg),0.55)] hover:bg-[rgba(var(--ui-fg),0.08)] hover:text-[rgba(var(--ui-fg),0.9)]"
                }`}
                onClick={toggleDrawer}
              >
                <Clock size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Sessions (S)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Bottom-left controls — only shown on map views */}
      {(view === "live" || view === "playback") && (
        <div className="absolute bottom-4 left-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-9 h-9 bg-(--pill-bg) border border-(--pill-border) rounded-xl backdrop-blur-xl text-[rgba(var(--ui-fg),0.55)] hover:bg-[rgba(var(--ui-fg),0.08)] hover:text-[rgba(var(--ui-fg),0.9)]"
                  onClick={handleNorthUp}
                >
                  <Navigation
                    size={16}
                    style={{ transform: "rotate(-45deg)" }}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>North Up</TooltipContent>
            </Tooltip>

            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-9 h-9 bg-(--pill-bg) border border-(--pill-border) rounded-xl backdrop-blur-xl text-[rgba(var(--ui-fg),0.55)] hover:bg-[rgba(var(--ui-fg),0.08)] hover:text-[rgba(var(--ui-fg),0.9)]"
                      aria-label="Settings"
                    >
                      <Settings size={16} />
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Settings</TooltipContent>
              </Tooltip>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Settings</DialogTitle>
                </DialogHeader>

                {/* Tabbed navigation */}
                <Tabs
                  value={settingsTab}
                  onValueChange={(v) => setSettingsTab(v as typeof settingsTab)}
                >
                  <TabsList className="w-full grid grid-cols-4 mb-2">
                    <TabsTrigger value="general" className="text-[11px]">
                      General
                    </TabsTrigger>
                    <TabsTrigger value="storage" className="text-[11px]">
                      Storage
                    </TabsTrigger>
                    <TabsTrigger value="notifications" className="text-[11px]">
                      Alerts
                    </TabsTrigger>
                    <TabsTrigger value="appearance" className="text-[11px]">
                      Appearance
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <ScrollArea className="max-h-[60vh]">
                  <div
                    style={{ paddingTop: 8, paddingBottom: 8 }}
                    className="flex flex-col gap-3"
                  >
                    {/* ── General Tab ── */}
                    {settingsTab === "general" && (
                      <div className="flex flex-col gap-3 tab-content-enter">
                        {/* DB path */}
                        {dbPath && (
                          <div
                            style={{ padding: "12px 16px" }}
                            className="bg-[rgba(var(--ui-fg),0.03)] rounded-xl border border-[rgba(var(--ui-fg),0.05)]"
                          >
                            <span className="text-[10px] font-semibold tracking-[0.8px] uppercase text-[rgba(var(--ui-fg),0.35)] block mb-1">
                              Database Path
                            </span>
                            <span className="text-[11px] text-[rgba(var(--ui-fg),0.5)] font-mono break-all">
                              {dbPath}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5 text-[11px] font-semibold tracking-[0.5px] uppercase"
                            onClick={handleOpenDataFolder}
                            title="Open database folder"
                          >
                            <FolderOpen size={12} />
                            Open Data Folder
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ── Appearance Tab ── */}
                    {settingsTab === "appearance" && (
                      <div className="flex flex-col gap-3 tab-content-enter">
                        <div
                          style={{ padding: "14px 16px" }}
                          className="flex items-center justify-between bg-[rgba(var(--ui-fg),0.03)] rounded-xl border border-[rgba(var(--ui-fg),0.05)]"
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.9)]">
                              Dark Mode
                            </span>
                            <span className="text-[11px] text-[rgba(var(--ui-fg),0.45)]">
                              Toggle between dark and light theme
                            </span>
                          </div>
                          <Switch
                            checked={darkMode}
                            onCheckedChange={setDarkMode}
                          />
                        </div>
                      </div>
                    )}

                    {/* ── Notifications Tab ── */}
                    {settingsTab === "notifications" && (
                      <div className="flex flex-col gap-3 tab-content-enter">
                        <div
                          style={{ padding: "14px 16px" }}
                          className="flex items-center justify-between bg-[rgba(var(--ui-fg),0.03)] rounded-xl border border-[rgba(var(--ui-fg),0.05)]"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <Bell
                                size={12}
                                className="text-[rgba(var(--ui-fg),0.5)]"
                              />
                              <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.9)]">
                                Health Alerts
                              </span>
                            </div>
                            <span className="text-[11px] text-[rgba(var(--ui-fg),0.45)]">
                              Alert when health score drops critically
                            </span>
                          </div>
                          <Switch
                            checked={notificationsEnabled}
                            onCheckedChange={handleToggleNotifications}
                          />
                        </div>
                      </div>
                    )}

                    {/* ── Storage Tab ── */}
                    {settingsTab === "storage" && (
                      <div className="flex flex-col gap-3 tab-content-enter">
                        {/* Stats summary */}
                        {stats && (
                          <div
                            style={{ padding: "12px 16px" }}
                            className="grid grid-cols-3 gap-3 bg-[rgba(var(--ui-fg),0.03)] rounded-xl border border-[rgba(var(--ui-fg),0.05)]"
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-semibold tracking-[0.8px] uppercase text-[rgba(var(--ui-fg),0.35)]">
                                Sessions
                              </span>
                              <span className="text-[14px] font-semibold text-[rgba(var(--ui-fg),0.85)] tabular-nums">
                                {stats.totalSessions}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-semibold tracking-[0.8px] uppercase text-[rgba(var(--ui-fg),0.35)]">
                                DB Size
                              </span>
                              <span className="text-[14px] font-semibold text-[rgba(var(--ui-fg),0.85)] tabular-nums">
                                {Number.isFinite(stats.databaseSizeMb)
                                  ? `${stats.databaseSizeMb.toFixed(1)} MB`
                                  : "—"}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-semibold tracking-[0.8px] uppercase text-[rgba(var(--ui-fg),0.35)]">
                                Oldest
                              </span>
                              <span className="text-[12px] font-medium text-[rgba(var(--ui-fg),0.65)] tabular-nums">
                                {(() => {
                                  if (!stats.oldestSession) return "—";
                                  try {
                                    return new Date(
                                      stats.oldestSession,
                                    ).toLocaleDateString();
                                  } catch {
                                    return "—";
                                  }
                                })()}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Auto-cleanup: age */}
                        <div
                          style={{ padding: "12px 16px" }}
                          className="flex items-center justify-between bg-[rgba(var(--ui-fg),0.03)] rounded-xl border border-[rgba(var(--ui-fg),0.05)]"
                        >
                          <div
                            className="flex flex-col gap-0.5"
                            style={{ flex: 1 }}
                          >
                            <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.9)]">
                              Auto-delete old sessions
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-[rgba(var(--ui-fg),0.45)]">
                                Delete sessions older than
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={365}
                                value={autoCleanupAge.days}
                                onChange={(e) =>
                                  setAutoCleanupAge((prev) => ({
                                    ...prev,
                                    days: Math.max(
                                      1,
                                      Math.min(
                                        365,
                                        parseInt(e.target.value) || 30,
                                      ),
                                    ),
                                  }))
                                }
                                className="w-12 text-center text-[12px] font-mono bg-[rgba(var(--ui-fg),0.06)] border border-[rgba(var(--ui-fg),0.1)] rounded text-[rgba(var(--ui-fg),0.8)]"
                                style={{ padding: "2px 4px" }}
                              />
                              <span className="text-[11px] text-[rgba(var(--ui-fg),0.45)]">
                                days
                              </span>
                            </div>
                          </div>
                          <Switch
                            checked={autoCleanupAge.enabled}
                            onCheckedChange={(v) =>
                              setAutoCleanupAge((prev) => ({
                                ...prev,
                                enabled: v,
                              }))
                            }
                          />
                        </div>

                        {/* Auto-cleanup: max count */}
                        <div
                          style={{ padding: "12px 16px" }}
                          className="flex items-center justify-between bg-[rgba(var(--ui-fg),0.03)] rounded-xl border border-[rgba(var(--ui-fg),0.05)]"
                        >
                          <div
                            className="flex flex-col gap-0.5"
                            style={{ flex: 1 }}
                          >
                            <span className="text-[13px] font-medium text-[rgba(var(--ui-fg),0.9)]">
                              Limit total sessions
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-[rgba(var(--ui-fg),0.45)]">
                                Keep at most
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={9999}
                                value={autoCleanupMax.count}
                                onChange={(e) =>
                                  setAutoCleanupMax((prev) => ({
                                    ...prev,
                                    count: Math.max(
                                      1,
                                      Math.min(
                                        9999,
                                        parseInt(e.target.value) || 100,
                                      ),
                                    ),
                                  }))
                                }
                                className="w-14 text-center text-[12px] font-mono bg-[rgba(var(--ui-fg),0.06)] border border-[rgba(var(--ui-fg),0.1)] rounded text-[rgba(var(--ui-fg),0.8)]"
                                style={{ padding: "2px 4px" }}
                              />
                              <span className="text-[11px] text-[rgba(var(--ui-fg),0.45)]">
                                sessions
                              </span>
                            </div>
                          </div>
                          <Switch
                            checked={autoCleanupMax.enabled}
                            onCheckedChange={(v) =>
                              setAutoCleanupMax((prev) => ({
                                ...prev,
                                enabled: v,
                              }))
                            }
                          />
                        </div>

                        {/* Action buttons */}
                        <div
                          className="flex items-center gap-2"
                          style={{ marginTop: 4 }}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 gap-1.5 text-[11px] font-semibold tracking-[0.5px] uppercase"
                            onClick={handleManualCleanup}
                            disabled={
                              storageBusy ||
                              (!autoCleanupAge.enabled &&
                                !autoCleanupMax.enabled)
                            }
                            title="Run cleanup now with current settings"
                          >
                            <Database size={12} />
                            Run Cleanup
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="text-[11px]"
                            onClick={handleOpenDataFolder}
                            title="Open database folder"
                          >
                            <FolderOpen size={12} />
                          </Button>
                        </div>

                        {/* Delete all sessions */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="sm"
                              className="w-full gap-1.5 text-[11px] font-semibold tracking-[0.5px] uppercase bg-(--accent-red)/8 text-(--accent-red) border border-(--accent-red)/15 hover:bg-(--accent-red)/15"
                            >
                              <Trash2 size={12} />
                              Delete All Sessions
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete all sessions?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete all completed
                                sessions and their data. Active recordings will
                                not be affected. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={handleDeleteAll}
                                disabled={storageBusy}
                                className="bg-(--accent-red) text-white hover:bg-(--accent-red)/80"
                              >
                                {storageBusy ? "Deleting…" : "Delete All"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        {/* Status message */}
                        {storageMsg && (
                          <span className="text-[11px] text-center font-medium text-(--accent-cyan)">
                            {storageMsg}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>

            <div
              style={{ padding: "8px 16px" }}
              className="inline-flex items-center gap-2.5 bg-(--pill-bg) border border-(--pill-border) rounded-(--pill-radius) backdrop-blur-xl"
            >
              <span className="text-[12px] font-medium tracking-[0.5px] text-[rgba(var(--ui-fg),0.5)] font-mono tabular-nums">
                {clock}
              </span>
            </div>
          </div>

          {hasFrame && (
            <div
              style={{ padding: "10px 16px" }}
              className="inline-flex items-center gap-3.5 bg-(--pill-bg) border border-(--pill-border) rounded-(--pill-radius) backdrop-blur-xl max-[900px]:hidden"
            >
              <span className="flex flex-col gap-px">
                <span className="text-[10px] font-semibold tracking-[1.2px] uppercase text-[rgba(var(--ui-fg),0.3)]">
                  Throughput
                </span>
                <span className="font-mono text-[13px] font-semibold text-[rgba(var(--ui-fg),0.75)] tabular-nums whitespace-nowrap transition-colors duration-300">
                  {formatBitRate(bps * 8)}
                </span>
              </span>
              <span className="w-px h-4 bg-[rgba(var(--ui-fg),0.08)] shrink-0" />
              <span className="flex flex-col gap-px">
                <span className="text-[10px] font-semibold tracking-[1.2px] uppercase text-[rgba(var(--ui-fg),0.3)]">
                  Upload
                </span>
                <span className="font-mono text-[13px] font-semibold text-(--accent-orange) tabular-nums whitespace-nowrap transition-colors duration-300">
                  {formatBitRate(uploadBps * 8)}
                </span>
              </span>
              <span className="w-px h-4 bg-[rgba(var(--ui-fg),0.08)] shrink-0" />
              <span className="flex flex-col gap-px">
                <span className="text-[10px] font-semibold tracking-[1.2px] uppercase text-[rgba(var(--ui-fg),0.3)]">
                  Download
                </span>
                <span className="font-mono text-[13px] font-semibold text-(--accent-cyan) tabular-nums whitespace-nowrap transition-colors duration-300">
                  {formatBitRate(downloadBps * 8)}
                </span>
              </span>
              <span className="w-px h-4 bg-[rgba(var(--ui-fg),0.08)] shrink-0" />
              <span className="flex flex-col gap-px">
                <span className="text-[10px] font-semibold tracking-[1.2px] uppercase text-[rgba(var(--ui-fg),0.3)]">
                  Latency
                </span>
                <span className="font-mono text-[13px] font-semibold text-(--accent-amber) tabular-nums whitespace-nowrap transition-colors duration-300">
                  {latencyMs.toFixed(0)} ms
                </span>
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
};
