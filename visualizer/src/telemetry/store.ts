import { create } from "zustand";
import {
  TelemetryFrame,
  DerivedMetrics,
  computeDerivedMetrics,
  GeoFlow,
} from "./schema";
import type {
  SessionInfo,
  PlaybackFrameRecord,
  PlaybackFlowRecord,
  PlaybackData,
} from "./sessions";

/** Which top-level view the app is showing. */
export type AppView =
  | "live"
  | "session-detail"
  | "playback"
  | "analytics"
  | "comparison";

/**
 * Fixed-capacity ring buffer backed by Float64Array.
 * Avoids spread+shift allocation churn on every telemetry frame.
 */
class RingBuffer {
  private buf: Float64Array;
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buf = new Float64Array(capacity);
  }

  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Reset the buffer to empty. */
  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  /** Returns a new array in chronological order (for Sparkline rendering). */
  toArray(): number[] {
    if (this.count === 0) return [];
    const result = new Array<number>(this.count);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(start + i) % this.capacity];
    }
    return result;
  }
}

interface TelemetryState {
  // ── Live telemetry ──
  frame: TelemetryFrame | null;
  derived: DerivedMetrics;
  connected: boolean;
  flows: GeoFlow[];
  throughputHistory: number[];
  latencyHistory: number[];
  ingestFrame: (frame: TelemetryFrame) => void;
  setConnected: (connected: boolean) => void;

  // ── App navigation ──
  view: AppView;
  setView: (view: AppView) => void;

  // ── Session drawer ──
  drawerOpen: boolean;
  toggleDrawer: () => void;
  setDrawerOpen: (open: boolean) => void;

  // ── Session detail ──
  selectedSessionId: string | null;
  selectedSession: SessionInfo | null;
  selectSession: (id: string | null, info?: SessionInfo | null) => void;

  // ── Session comparison ──
  comparisonIds: [string, string] | null;
  startComparison: (a: string, b: string) => void;

  // ── Recording indicator ──
  recording: boolean;
  currentSessionId: string | null;
  setRecording: (recording: boolean, sessionId?: string | null) => void;

  // ── Playback mode ──
  playback: {
    active: boolean;
    paused: boolean;
    speed: number; // 1, 2, 5, 10
    position: number; // current frame index
    sessionInfo: SessionInfo | null;
    frames: PlaybackFrameRecord[];
    /** flows grouped by frame_id for O(1) lookup */
    flowsByFrame: Map<number, PlaybackFlowRecord[]>;
    localLat: number;
    localLng: number;
  };
  startPlayback: (data: PlaybackData) => void;
  stopPlayback: () => void;
  togglePlaybackPause: () => void;
  setPlaybackSpeed: (speed: number) => void;
  seekPlayback: (index: number) => void;
  tickPlayback: () => void;
}

const EMPTY_DERIVED: DerivedMetrics = {
  throughputMbps: 0,
  uploadMbps: 0,
  downloadMbps: 0,
  networkPressure: 0,
  topCountries: [],
  topProtocols: [],
};

const HISTORY_LENGTH = 60;

// Pre-allocated ring buffers — persist across store updates
const throughputRing = new RingBuffer(HISTORY_LENGTH);
const latencyRing = new RingBuffer(HISTORY_LENGTH);

/** Valid playback speed multipliers. */
const VALID_SPEEDS = new Set([1, 2, 5, 10]);

/** Sanitize a numeric value — returns 0 for NaN/Infinity/null/undefined. */
function safeNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Convert a PlaybackFrameRecord + its flows into a TelemetryFrame, DerivedMetrics,
 * and push throughput/latency to the ring buffers. Shared by seekPlayback & tickPlayback.
 */
function buildPlaybackFrame(
  fr: PlaybackFrameRecord,
  frameFlows: PlaybackFlowRecord[],
  localLat: number,
  localLng: number,
): {
  frame: TelemetryFrame;
  derived: DerivedMetrics;
  flows: GeoFlow[];
  throughputHistory: number[];
  latencyHistory: number[];
} {
  const geoFlows: GeoFlow[] = frameFlows.map((f) => ({
    id: f.flowId,
    src: {
      ip: f.srcIp,
      lat: localLat,
      lng: localLng,
      city: f.srcCity,
      country: f.srcCountry,
    },
    dst: {
      ip: f.dstIp,
      lat: safeNum(f.dstLat),
      lng: safeNum(f.dstLng),
      city: f.dstCity,
      country: f.dstCountry,
    },
    bps: safeNum(f.bps),
    pps: safeNum(f.pps),
    rtt: safeNum(f.rtt),
    protocol: f.protocol,
    dir: (f.dir as "up" | "down" | "bidi") || "bidi",
    port: safeNum(f.port),
    service: f.service || undefined,
    startedAt: safeNum(f.startedAt),
  }));

  const telFrame: TelemetryFrame = {
    schema: 1,
    t: fr.t,
    net: {
      bps: safeNum(fr.bps),
      pps: safeNum(fr.pps),
      activeFlows: safeNum(fr.activeFlows),
      latencyMs: safeNum(fr.latencyMs),
      uploadBps: safeNum(fr.uploadBps),
      downloadBps: safeNum(fr.downloadBps),
    },
    proto: {
      tcp: safeNum(fr.protoTcp),
      udp: safeNum(fr.protoUdp),
      icmp: safeNum(fr.protoIcmp),
      dns: safeNum(fr.protoDns),
      https: safeNum(fr.protoHttps),
      http: safeNum(fr.protoHttp),
      other: safeNum(fr.protoOther),
    },
    flows: geoFlows,
  };

  const derived = computeDerivedMetrics(telFrame);
  const throughput = Number.isFinite(derived.throughputMbps)
    ? Math.max(0, derived.throughputMbps)
    : 0;
  const latency = Number.isFinite(telFrame.net.latencyMs)
    ? Math.max(0, telFrame.net.latencyMs)
    : 0;

  throughputRing.push(throughput);
  latencyRing.push(latency);

  return {
    frame: telFrame,
    derived,
    flows: geoFlows,
    throughputHistory: throughputRing.toArray(),
    latencyHistory: latencyRing.toArray(),
  };
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  // ── Live telemetry ──
  frame: null,
  derived: EMPTY_DERIVED,
  connected: false,
  flows: [],
  throughputHistory: [],
  latencyHistory: [],

  ingestFrame: (frame: TelemetryFrame) => {
    // Don't overwrite state during playback — live events still fire
    const state = useTelemetryStore.getState();
    if (state.playback.active) return;

    const derived = computeDerivedMetrics(frame);
    const throughput = Number.isFinite(derived.throughputMbps)
      ? Math.max(0, derived.throughputMbps)
      : 0;
    const latency = Number.isFinite(frame.net.latencyMs)
      ? Math.max(0, frame.net.latencyMs)
      : 0;

    throughputRing.push(throughput);
    latencyRing.push(latency);

    set({
      frame,
      derived,
      flows: Array.isArray(frame.flows) ? frame.flows : [],
      throughputHistory: throughputRing.toArray(),
      latencyHistory: latencyRing.toArray(),
    });
  },

  setConnected: (connected: boolean) => set({ connected }),

  // ── App navigation ──
  view: "live" as AppView,
  setView: (view: AppView) => set({ view }),

  // ── Session drawer ──
  drawerOpen: false,
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setDrawerOpen: (open: boolean) => set({ drawerOpen: open }),

  // ── Session detail ──
  selectedSessionId: null,
  selectedSession: null,
  selectSession: (id, info) =>
    set({
      selectedSessionId: id,
      selectedSession: info ?? null,
      view: id ? "session-detail" : "live",
    }),

  // ── Session comparison ──
  comparisonIds: null,
  startComparison: (a, b) => {
    if (!a || !b || a === b) return;
    set({ comparisonIds: [a, b], view: "comparison" as AppView });
  },

  // ── Recording indicator ──
  recording: false,
  currentSessionId: null,
  setRecording: (recording, sessionId) =>
    set({ recording, currentSessionId: sessionId ?? null }),

  // ── Playback mode ──
  playback: {
    active: false,
    paused: false,
    speed: 1,
    position: 0,
    sessionInfo: null,
    frames: [],
    flowsByFrame: new Map(),
    localLat: 0,
    localLng: 0,
  },

  startPlayback: (data: PlaybackData) => {
    // Group flows by frame_id for O(1) lookup during scrub
    const flowsByFrame = new Map<number, PlaybackFlowRecord[]>();
    for (const flow of data.flows) {
      let arr = flowsByFrame.get(flow.frameId);
      if (!arr) {
        arr = [];
        flowsByFrame.set(flow.frameId, arr);
      }
      arr.push(flow);
    }

    // Reset ring buffers for clean playback history
    throughputRing.clear();
    latencyRing.clear();

    set({
      view: "playback" as AppView,
      playback: {
        active: true,
        paused: false,
        speed: 1,
        position: 0,
        sessionInfo: data.session,
        frames: data.frames,
        flowsByFrame,
        localLat: data.session.localLat ?? 0,
        localLng: data.session.localLng ?? 0,
      },
    });
  },

  stopPlayback: () =>
    set({
      view: "live" as AppView,
      playback: {
        active: false,
        paused: false,
        speed: 1,
        position: 0,
        sessionInfo: null,
        frames: [],
        flowsByFrame: new Map(),
        localLat: 0,
        localLng: 0,
      },
    }),

  togglePlaybackPause: () =>
    set((s) => ({
      playback: { ...s.playback, paused: !s.playback.paused },
    })),

  setPlaybackSpeed: (speed: number) =>
    set((s) => ({
      playback: {
        ...s.playback,
        speed: VALID_SPEEDS.has(speed) ? speed : 1,
      },
    })),

  seekPlayback: (index: number) =>
    set((s) => {
      const { frames, flowsByFrame, localLat, localLng } = s.playback;
      if (frames.length === 0) return {};

      const clamped = Math.max(0, Math.min(index, frames.length - 1));
      const fr = frames[clamped];
      const frameFlows = flowsByFrame.get(fr.frameId) ?? [];

      const result = buildPlaybackFrame(fr, frameFlows, localLat, localLng);
      return {
        ...result,
        playback: { ...s.playback, position: clamped },
      };
    }),

  tickPlayback: () =>
    set((s) => {
      if (!s.playback.active || s.playback.paused) return {};
      const next = s.playback.position + 1;
      if (next >= s.playback.frames.length) {
        // Reached end — pause at last frame
        return { playback: { ...s.playback, paused: true } };
      }

      const { frames, flowsByFrame, localLat, localLng } = s.playback;
      const fr = frames[next];
      const frameFlows = flowsByFrame.get(fr.frameId) ?? [];

      const result = buildPlaybackFrame(fr, frameFlows, localLat, localLng);
      return {
        ...result,
        playback: { ...s.playback, position: next },
      };
    }),
}));
