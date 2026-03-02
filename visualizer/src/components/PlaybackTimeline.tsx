import React, { useEffect, useRef, useCallback, useMemo, useState } from "react";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
} from "lucide-react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { useTelemetryStore } from "../telemetry/store";
import { formatDuration } from "../lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

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
  const sessionName = useTelemetryStore((s) => s.playback.sessionInfo?.name || "Session");
  const seekPlayback = useTelemetryStore((s) => s.seekPlayback);
  const tickPlayback = useTelemetryStore((s) => s.tickPlayback);
  const togglePlaybackPause = useTelemetryStore((s) => s.togglePlaybackPause);
  const setPlaybackSpeed = useTelemetryStore((s) => s.setPlaybackSpeed);
  const stopPlayback = useTelemetryStore((s) => s.stopPlayback);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Hover state for timeline preview */
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

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
    [active, togglePlaybackPause, seekPlayback, stopPlayback]
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

  const isComplete = paused && totalFrames > 1 && position >= totalFrames - 1;

  // Time labels — read frames from store only for the time display
  const { frames } = useTelemetryStore.getState().playback;
  const currentFrame = frames[position];
  const firstFrame = frames[0];
  const lastFrame = frames[totalFrames - 1];
  const elapsedSecs = currentFrame && firstFrame ? currentFrame.t - firstFrame.t : 0;
  const totalSecs = lastFrame && firstFrame ? lastFrame.t - firstFrame.t : 0;

  // Hover time preview
  const hoverSecs = useMemo(() => {
    if (hoverPos === null || !firstFrame) return null;
    const hFrame = frames[hoverPos];
    return hFrame ? hFrame.t - firstFrame.t : null;
  }, [hoverPos, frames, firstFrame]);

  // Mini-waveform SVG path from throughput data
  const waveformPath = useMemo(() => {
    if (frames.length < 2) return "";
    const maxBps = Math.max(...frames.map((f) => f.bps)) || 1;
    const w = 1000; // viewBox width
    const h = 28; // viewBox height
    const step = w / (frames.length - 1);
    const points = frames.map((f, i) => `${i * step},${h - (f.bps / maxBps) * h}`);
    return `M${points.join("L")}L${w},${h}L0,${h}Z`;
  }, [frames]);

  // Handle hover on scrubber for time preview
  const handleScrubberHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!scrubberRef.current || totalFrames < 2) return;
      const rect = scrubberRef.current.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const frameIdx = Math.round(relX * (totalFrames - 1));
      setHoverPos(frameIdx);
    },
    [totalFrames]
  );

  const handleScrubberLeave = useCallback(() => {
    setHoverPos(null);
  }, []);

  return (
    <div
      role="toolbar"
      aria-label="Playback controls"
      className="absolute bottom-0 left-0 right-0 z-30"
      style={{ padding: "0 12px 10px 12px" }}
    >
      <div
        className="bg-[rgba(var(--ui-bg),0.85)] backdrop-blur-xl border border-[rgba(var(--ui-fg),0.08)] rounded-xl shadow-[0_-4px_24px_rgba(0,0,0,0.3)]"
        style={{ padding: "10px 16px 8px 16px" }}
      >
        {/* Top row: session badge + timestamps */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge className="bg-(--accent-cyan)/10 text-(--accent-cyan) border-(--accent-cyan)/20 text-[14px] font-medium px-2 py-0.5">
              ▶ PLAYBACK
            </Badge>
            <span
              className="text-[13px] text-[rgba(var(--ui-fg),0.45)] truncate max-w-40"
              title={sessionName}
            >
              {sessionName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Elapsed / Total time */}
            <span className="text-[13px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.7)]">
              {formatDuration(elapsedSecs)}
            </span>
            <span className="text-[14px] text-[rgba(var(--ui-fg),0.25)]">/</span>
            <span className="text-[13px] font-mono tabular-nums text-[rgba(var(--ui-fg),0.35)]">
              {formatDuration(totalSecs)}
            </span>
          </div>
        </div>

        {/* Waveform + Radix Slider scrubber */}
        <div
          ref={scrubberRef}
          className="relative group mb-2"
          style={{ height: 32 }}
          onMouseMove={handleScrubberHover}
          onMouseLeave={handleScrubberLeave}
        >
          {/* Waveform background layer */}
          {waveformPath && (
            <svg
              viewBox="0 0 1000 28"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full pointer-events-none"
              style={{ opacity: 0.12, height: 28, top: 2 }}
            >
              <path d={waveformPath} fill="var(--accent-cyan)" />
            </svg>
          )}

          {/* Hover time preview tooltip */}
          {hoverPos !== null && hoverSecs !== null && totalFrames > 1 && (
            <div
              className="absolute -top-7 pointer-events-none z-10 bg-[rgba(var(--ui-bg),0.95)] border border-[rgba(var(--ui-fg),0.1)] rounded-md px-2 py-0.5 text-[14px] font-mono text-[rgba(var(--ui-fg),0.6)] shadow-sm whitespace-nowrap"
              style={{
                left: `${(hoverPos / (totalFrames - 1)) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              {formatDuration(hoverSecs)}
            </div>
          )}

          {/* Radix UI Slider — proper accessible scrubber */}
          <SliderPrimitive.Root
            className="relative flex w-full touch-none select-none items-center"
            style={{ height: 32 }}
            min={0}
            max={Math.max(0, totalFrames - 1)}
            step={1}
            value={[position]}
            onValueChange={(val) => seekPlayback(val[0])}
            aria-label="Playback position"
          >
            <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[rgba(var(--ui-fg),0.08)] group-hover:h-2 transition-all duration-150">
              <SliderPrimitive.Range className="absolute h-full rounded-full bg-(--accent-cyan) transition-[width] duration-75" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb className="block h-3 w-3 rounded-full border-2 border-(--accent-cyan) bg-(--page-bg) shadow-[0_0_8px_rgba(0,212,245,0.4)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent-cyan) focus-visible:ring-offset-1 focus-visible:ring-offset-(--page-bg) hover:scale-125 hover:shadow-[0_0_12px_rgba(0,212,245,0.6)] cursor-pointer opacity-0 group-hover:opacity-100" />
          </SliderPrimitive.Root>
        </div>

        {/* Controls row: transport + speed + stop */}
        <div className="flex items-center justify-between">
          {/* Transport controls */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-[rgba(var(--ui-fg),0.5)] hover:text-[rgba(var(--ui-fg),0.9)] hover:bg-[rgba(var(--ui-fg),0.08)]"
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
                  className="w-7 h-7 text-[rgba(var(--ui-fg),0.5)] hover:text-[rgba(var(--ui-fg),0.9)] hover:bg-[rgba(var(--ui-fg),0.08)]"
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
                  className="w-8 h-8 text-(--accent-cyan) hover:brightness-125 hover:bg-(--accent-cyan)/10 rounded-full"
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
                  {isComplete ? (
                    <RotateCcw size={16} />
                  ) : paused ? (
                    <Play size={16} />
                  ) : (
                    <Pause size={16} />
                  )}
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
                  className="w-7 h-7 text-[rgba(var(--ui-fg),0.5)] hover:text-[rgba(var(--ui-fg),0.9)] hover:bg-[rgba(var(--ui-fg),0.08)]"
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
                  className="w-7 h-7 text-[rgba(var(--ui-fg),0.5)] hover:text-[rgba(var(--ui-fg),0.9)] hover:bg-[rgba(var(--ui-fg),0.08)]"
                  onClick={() => seekPlayback(totalFrames - 1)}
                  aria-label="Go to end"
                >
                  <SkipForward size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Go to end (End)</TooltipContent>
            </Tooltip>
          </div>

          {/* Center: frame indicator */}
          <div className="text-[14px] text-[rgba(var(--ui-fg),0.3)] font-mono tabular-nums">
            {isComplete ? (
              <span className="text-(--accent-green)">Playback complete</span>
            ) : (
              <>
                Frame {position + 1} / {totalFrames}
              </>
            )}
          </div>

          {/* Right: speed selector + stop */}
          <div className="flex items-center gap-2">
            {/* Speed selector — Radix ToggleGroup with proper a11y */}
            <ToggleGroup
              type="single"
              value={String(speed)}
              onValueChange={(val) => {
                if (val) setPlaybackSpeed(Number(val));
              }}
              aria-label="Playback speed"
            >
              {SPEEDS.map((spd) => (
                <ToggleGroupItem key={spd} value={String(spd)} aria-label={`${spd}× speed`}>
                  {spd}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {/* Stop (exit playback) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-[rgba(var(--ui-fg),0.35)] hover:text-(--accent-red) hover:bg-(--accent-red)/10"
                  onClick={stopPlayback}
                  aria-label="Stop playback"
                >
                  <Square size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop playback (Esc)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
};
