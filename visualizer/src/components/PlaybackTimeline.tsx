import React, { useEffect, useRef, useCallback, useMemo } from "react";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import { formatDuration } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

const SPEEDS = [1, 2, 5, 10] as const;

/** Seconds between stored frames (FRAME_SAMPLE interval in the backend). */
const FRAME_INTERVAL_S = 5;

export const PlaybackTimeline: React.FC = () => {
  // Granular selectors — avoid re-render on unrelated playback state changes
  const active = useTelemetryStore((s) => s.playback.active);
  const paused = useTelemetryStore((s) => s.playback.paused);
  const speed = useTelemetryStore((s) => s.playback.speed);
  const position = useTelemetryStore((s) => s.playback.position);
  const totalFrames = useTelemetryStore((s) => s.playback.frames.length);
  const sessionName = useTelemetryStore(
    (s) => s.playback.sessionInfo?.name || "Session",
  );
  const seekPlayback = useTelemetryStore((s) => s.seekPlayback);
  const tickPlayback = useTelemetryStore((s) => s.tickPlayback);
  const togglePlaybackPause = useTelemetryStore((s) => s.togglePlaybackPause);
  const setPlaybackSpeed = useTelemetryStore((s) => s.setPlaybackSpeed);
  const stopPlayback = useTelemetryStore((s) => s.stopPlayback);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Tick interval — drives playback forward ────────────────────────────
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (active && !paused) {
      // Base tick rate is 1 frame per FRAME_INTERVAL_S seconds.
      // Speed multiplier accelerates this.
      const ms = Math.max(50, (FRAME_INTERVAL_S * 1000) / speed);
      intervalRef.current = setInterval(() => {
        tickPlayback();
      }, ms);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, paused, speed, tickPlayback]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!active) return;

      // Don't capture keys when inside inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Read current position from store to avoid stale closure
      const { position: pos, frames } = useTelemetryStore.getState().playback;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlaybackPause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+Left: jump −60s (12 frames at 5s interval)
            seekPlayback(pos - 12);
          } else {
            // Left: jump −10s (2 frames)
            seekPlayback(pos - 2);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+Right: jump +60s
            seekPlayback(pos + 12);
          } else {
            // Right: jump +10s
            seekPlayback(pos + 2);
          }
          break;
        case "Home":
          e.preventDefault();
          seekPlayback(0);
          break;
        case "End":
          e.preventDefault();
          seekPlayback(frames.length - 1);
          break;
        case "Escape":
          e.preventDefault();
          stopPlayback();
          break;
      }
    },
    [active, togglePlaybackPause, seekPlayback, stopPlayback],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  // ── Seek on first frame when playback starts ───────────────────────────
  const initialSeekDone = useRef(false);
  useEffect(() => {
    if (active && totalFrames > 0 && !initialSeekDone.current) {
      initialSeekDone.current = true;
      seekPlayback(0);
    }
    if (!active) {
      initialSeekDone.current = false;
    }
  }, [active, totalFrames, seekPlayback]);

  if (!active) return null;

  const progress = totalFrames > 1 ? position / (totalFrames - 1) : 0;
  const isComplete = paused && totalFrames > 1 && position >= totalFrames - 1;

  // Time labels — read frames from store only for the time display
  const { frames } = useTelemetryStore.getState().playback;
  const currentFrame = frames[position];
  const firstFrame = frames[0];
  const lastFrame = frames[totalFrames - 1];
  const elapsedSecs =
    currentFrame && firstFrame ? currentFrame.t - firstFrame.t : 0;
  const totalSecs = lastFrame && firstFrame ? lastFrame.t - firstFrame.t : 0;

  // Mini-waveform SVG path from throughput data
  const waveformPath = useMemo(() => {
    if (frames.length < 2) return "";
    const maxBps = Math.max(...frames.map((f) => f.bps)) || 1;
    const w = 1000; // viewBox width
    const h = 24; // viewBox height
    const step = w / (frames.length - 1);
    const points = frames.map(
      (f, i) => `${i * step},${h - (f.bps / maxBps) * h}`,
    );
    return `M${points.join("L")}L${w},${h}L0,${h}Z`;
  }, [frames]);

  return (
    <div
      role="toolbar"
      aria-label="Playback controls"
      className="absolute bottom-0 left-0 right-0 z-30 bg-[rgba(var(--ui-bg),0.9)] backdrop-blur-md border-t border-[rgba(var(--ui-fg),0.1)]"
      style={{ padding: "8px 16px" }}
    >
      {/* Top row: session name + time */}
      <div className="flex items-center justify-between text-xs text-[rgba(var(--ui-fg),0.5)] mb-1">
        <span className="truncate max-w-50" title={sessionName}>
          ▶ {sessionName}
        </span>
        <span>
          {formatDuration(elapsedSecs)} / {formatDuration(totalSecs)}
        </span>
      </div>

      {/* Main controls row */}
      <div className="flex items-center gap-3">
        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-[rgba(var(--ui-fg),0.6)] hover:text-[rgba(var(--ui-fg),1)] hover:bg-[rgba(var(--ui-fg),0.1)]"
                onClick={() => seekPlayback(0)}
                aria-label="Go to start"
              >
                <SkipBack size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Go to start (Home)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-[rgba(var(--ui-fg),0.6)] hover:text-[rgba(var(--ui-fg),1)] hover:bg-[rgba(var(--ui-fg),0.1)]"
                onClick={() => seekPlayback(position - 12)}
                aria-label="Back 60 seconds"
              >
                <ChevronsLeft size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back 60s (Shift+←)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 text-[var(--accent-cyan)] hover:brightness-125 hover:bg-[var(--accent-cyan)]/10"
                onClick={() => {
                  if (isComplete) {
                    seekPlayback(0);
                    togglePlaybackPause();
                  } else {
                    togglePlaybackPause();
                  }
                }}
                aria-label={isComplete ? "Replay" : paused ? "Play" : "Pause"}
              >
                {paused ? <Play size={18} /> : <Pause size={18} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isComplete ? "Replay" : paused ? "Play" : "Pause"} (Space)
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-[rgba(var(--ui-fg),0.6)] hover:text-[rgba(var(--ui-fg),1)] hover:bg-[rgba(var(--ui-fg),0.1)]"
                onClick={() => seekPlayback(position + 12)}
                aria-label="Forward 60 seconds"
              >
                <ChevronsRight size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward 60s (Shift+→)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6 text-[rgba(var(--ui-fg),0.6)] hover:text-[rgba(var(--ui-fg),1)] hover:bg-[rgba(var(--ui-fg),0.1)]"
                onClick={() => seekPlayback(totalFrames - 1)}
                aria-label="Go to end"
              >
                <SkipForward size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Go to end (End)</TooltipContent>
          </Tooltip>
        </div>

        {/* Scrub bar with waveform */}
        <div className="flex-1 relative group" style={{ padding: "4px 0" }}>
          {/* Waveform background */}
          {waveformPath && (
            <svg
              viewBox="0 0 1000 24"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ opacity: 0.15 }}
            >
              <path d={waveformPath} fill="var(--accent-cyan)" />
            </svg>
          )}
          {/* Track background */}
          <div className="h-1.5 bg-[rgba(var(--ui-fg),0.1)] rounded-full overflow-hidden relative z-[1]">
            {/* Progress fill */}
            <div
              className="h-full bg-(--accent-cyan) rounded-full transition-[width] duration-100"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          {/* Invisible range input for scrubbing */}
          <input
            type="range"
            min={0}
            max={Math.max(0, totalFrames - 1)}
            value={position}
            onChange={(e) => seekPlayback(Number(e.target.value))}
            aria-label="Playback position"
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            style={{ height: "20px", margin: "-6px 0 0 0" }}
          />
        </div>

        {/* Speed controls */}
        <div className="flex items-center gap-0.5">
          {SPEEDS.map((spd) => (
            <Button
              key={spd}
              variant="ghost"
              size="sm"
              className={`text-xs font-mono h-6 px-1.5 ${
                speed === spd
                  ? "text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/15"
                  : "text-[rgba(var(--ui-fg),0.4)] hover:text-[rgba(var(--ui-fg),0.7)]"
              }`}
              onClick={() => setPlaybackSpeed(spd)}
            >
              {spd}×
            </Button>
          ))}
        </div>

        {/* Stop (exit playback) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6 text-[rgba(var(--ui-fg),0.4)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
              onClick={stopPlayback}
              aria-label="Stop playback"
            >
              <Square size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Stop playback (Esc)</TooltipContent>
        </Tooltip>
      </div>

      {/* Frame indicator */}
      <div className="text-[10px] text-[rgba(var(--ui-fg),0.3)] text-right mt-0.5">
        {isComplete ? (
          <span className="text-[var(--accent-green)]">Playback complete</span>
        ) : (
          <>
            Frame {position + 1} / {totalFrames} · {speed}× speed
          </>
        )}
      </div>
    </div>
  );
};
