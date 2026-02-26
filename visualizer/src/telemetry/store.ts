import { create } from "zustand";
import {
  TelemetryFrame,
  DerivedMetrics,
  computeDerivedMetrics,
  GeoFlow,
} from "./schema";

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

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
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

    const tHistory = [...get().throughputHistory, throughput];
    if (tHistory.length > HISTORY_LENGTH) tHistory.shift();

    const lHistory = [...get().latencyHistory, latency];
    if (lHistory.length > HISTORY_LENGTH) lHistory.shift();

    set({
      frame,
      derived,
      flows: Array.isArray(frame.flows) ? frame.flows : [],
      throughputHistory: tHistory,
      latencyHistory: lHistory,
    });
  },

  setConnected: (connected: boolean) => set({ connected }),
}));
