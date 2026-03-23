import { useEffect, useState, lazy, Suspense } from "react";
import { useShallow } from "zustand/react/shallow";
const NetworkMap = lazy(() =>
  import("./components/NetworkMap").then((m) => ({ default: m.NetworkMap }))
);
import { TopBar } from "./components/TopBar";
import { StatsPanel } from "./components/StatsPanel";
import { SessionDrawer } from "./components/SessionDrawer";
const SessionDetail = lazy(() =>
  import("./components/SessionDetail").then((m) => ({ default: m.SessionDetail }))
);
import { PlaybackTimeline } from "./components/PlaybackTimeline";
const AnalyticsDashboard = lazy(() =>
  import("./components/AnalyticsDashboard").then((m) => ({ default: m.AnalyticsDashboard }))
);
const SessionComparison = lazy(() =>
  import("./components/SessionComparison").then((m) => ({ default: m.SessionComparison }))
);
import { CommandPalette } from "./components/CommandPalette";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { useTelemetryStore } from "./telemetry/store";
import type { TelemetryFrame } from "./telemetry/schema";
import { startSession, stopSession } from "./telemetry/sessions";
import { releaseCables } from "./telemetry/cables";

export default function App() {
  const {
    ingestFrame,
    setConnected,
    view,
    setView,
    setRecording,
    recording,
    drawerOpen,
    setDrawerOpen,
    connected,
    isVisible,
    setVisible,
  } = useTelemetryStore(
    useShallow((s) => ({
      ingestFrame: s.ingestFrame,
      setConnected: s.setConnected,
      view: s.view,
      setView: s.setView,
      setRecording: s.setRecording,
      recording: s.recording,
      drawerOpen: s.drawerOpen,
      setDrawerOpen: s.setDrawerOpen,
      connected: s.connected,
      isVisible: s.isVisible,
      setVisible: s.setVisible,
    }))
  );
  const [hasSeenTelemetry, setHasSeenTelemetry] = useState(false);

  useEffect(() => {
    if (connected) setHasSeenTelemetry(true);
  }, [connected]);

  // ── Visibility / background mode ──────────────────────────────────────
  useEffect(() => {
    let timer: number | undefined;
    const apply = (visible: boolean) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        setVisible(visible);
        if (!visible) releaseCables();
      }, 300);
    };
    const onVisChange = () => apply(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisChange);

    // Also listen for Tauri focus/blur (more reliable on desktop)
    let unFocus: (() => void) | null = null;
    let unBlur: (() => void) | null = null;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        listen("tauri://focus", () => apply(true)).then((u) => {
          unFocus = u;
        });
        listen("tauri://blur", () => apply(false)).then((u) => {
          unBlur = u;
        });
      })
      .catch(() => {});

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisChange);
      unFocus?.();
      unBlur?.();
    };
  }, [setVisible]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let active = true;

    setConnected(false);

    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (!active) return;
        listen<TelemetryFrame>("telemetry-frame", (event) => {
          if (!useTelemetryStore.getState().isVisible) return;
          ingestFrame(event.payload);
          setConnected(true);
        }).then((unlisten) => {
          if (active) cleanup = unlisten;
          else unlisten();
        });
      })
      .catch(() => {
        if (active) setConnected(false);
      });

    return () => {
      active = false;
      cleanup?.();
    };
  }, [ingestFrame, setConnected]);

  // Sync recording state on mount
  useEffect(() => {
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<string | null>("cmd_get_current_session").then((id) => {
        setRecording(!!id, id);
      });
    });
  }, [setRecording]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // S → Toggle session drawer
      if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setDrawerOpen(!drawerOpen);
        return;
      }

      // Escape → Go back to live view (if not already live)
      if (e.code === "Escape" && view !== "live" && view !== "playback") {
        e.preventDefault();
        setView("live");
        return;
      }

      // Ctrl+N → New session
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyN") {
        e.preventDefault();
        const start = async () => {
          try {
            if (recording) {
              await stopSession();
              setRecording(false, null);
            }
            const id = await startSession();
            setRecording(true, id);
          } catch (err) {
            console.error("Failed to start session:", err);
          }
        };
        start();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, setView, drawerOpen, setDrawerOpen, recording, setRecording]);

  return (
    <TooltipProvider delayDuration={300}>
      <a href="#main-content" className="skip-nav">
        Skip to content
      </a>
      <div
        id="main-content"
        role="main"
        className="relative w-full h-full after:content-[''] after:absolute after:inset-0 after:pointer-events-none after:z-5 after:bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(0,0,0,0.45)_100%)]"
      >
        {/* NetworkMap rendered once for both live & playback — avoids full map
            destruction / re-creation when switching between these views */}
        {isVisible && (view === "live" || view === "playback") && (
          <Suspense fallback={<div className="w-full h-full bg-[#080810]" />}>
            <NetworkMap />
          </Suspense>
        )}

        {view === "live" && (
          <>
            {/* Startup splash — shown before first telemetry frame */}
            {!connected && !hasSeenTelemetry && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[rgba(var(--ui-bg),0.6)] backdrop-blur-md transition-opacity duration-500">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-(--accent-cyan) animate-pulse" />
                  <span className="text-sm font-semibold tracking-wide text-[rgba(var(--ui-fg),0.7)]">
                    Abyss
                  </span>
                </div>
                <span className="text-[13px] text-[rgba(var(--ui-fg),0.3)]">
                  Connecting to sniffer…
                </span>
                <div className="flex gap-1 mt-2">
                  <div
                    className="w-1 h-1 rounded-full bg-[rgba(var(--ui-fg),0.15)] animate-bounce"
                    style={{ animationDelay: "0ms" }}
                  />
                  <div
                    className="w-1 h-1 rounded-full bg-[rgba(var(--ui-fg),0.15)] animate-bounce"
                    style={{ animationDelay: "150ms" }}
                  />
                  <div
                    className="w-1 h-1 rounded-full bg-[rgba(var(--ui-fg),0.15)] animate-bounce"
                    style={{ animationDelay: "300ms" }}
                  />
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between *:pointer-events-auto">
              <StatsPanel />
              <TopBar />
            </div>
          </>
        )}

        {view === "session-detail" && (
          <div className="view-enter w-full h-full">
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center text-[rgba(var(--ui-fg),0.3)] text-sm">
                  Loading…
                </div>
              }
            >
              <SessionDetail />
            </Suspense>
          </div>
        )}

        {view === "analytics" && (
          <div className="view-enter w-full h-full">
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center text-[rgba(var(--ui-fg),0.3)] text-sm">
                  Loading…
                </div>
              }
            >
              <AnalyticsDashboard />
            </Suspense>
          </div>
        )}

        {view === "comparison" && (
          <div className="view-enter w-full h-full">
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center text-[rgba(var(--ui-fg),0.3)] text-sm">
                  Loading…
                </div>
              }
            >
              <SessionComparison />
            </Suspense>
          </div>
        )}

        {view === "playback" && (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between *:pointer-events-auto">
              <StatsPanel />
            </div>
            <PlaybackTimeline />
          </>
        )}

        {/* TopBar overlaid on all views for navigation */}
        {view !== "live" && (
          <div className="pointer-events-none absolute inset-0 z-10 *:pointer-events-auto">
            <TopBar />
          </div>
        )}

        {/* Session drawer — available on all views */}
        <SessionDrawer />

        <CommandPalette />
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}
