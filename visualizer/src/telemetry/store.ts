import { create } from "zustand";
import {
  TelemetryFrame,
  DerivedMetrics,
  computeDerivedMetrics,
  GeoFlow,
} from "./schema";

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
  frame: TelemetryFrame | null;
  derived: DerivedMetrics;
  connected: boolean;
  flows: GeoFlow[];
  throughputHistory: number[];
  latencyHistory: number[];
  ingestFrame: (frame: TelemetryFrame) => void;
  setConnected: (connected: boolean) => void;
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

export const useTelemetryStore = create<TelemetryState>((set) => ({
  frame: null,
  derived: EMPTY_DERIVED,
  connected: false,
  flows: [],
  throughputHistory: [],
  latencyHistory: [],

  ingestFrame: (frame: TelemetryFrame) => {
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
}));
