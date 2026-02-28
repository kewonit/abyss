import { useRef, useEffect, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTelemetryStore } from "../telemetry/store";
import {
  loadCables,
  matchFlowsPerFlow,
  type CableCollection,
  type CableFeature,
  type FlowEndpointsWithId,
} from "../telemetry/cables";
import type { GeoFlow } from "../telemetry/schema";

const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

interface CableActivity {
  lastSeen: number;
  throughput: number;
  opacity: number;
  targetOpacity: number;
}

const FADE_OUT_DURATION = 3000;
const FADE_START_DELAY = 2000;
const MIN_OPACITY = 0.05;

function visFactor(
  lng: number,
  lat: number,
  cLng: number,
  cLat: number,
): number {
  const R = Math.PI / 180;
  const p1 = cLat * R,
    l1 = cLng * R;
  const p2 = lat * R,
    l2 = lng * R;
  const cos =
    Math.sin(p1) * Math.sin(p2) +
    Math.cos(p1) * Math.cos(p2) * Math.cos(l2 - l1);

  if (cos <= 0.05) return 0;
  if (cos < 0.2) return (cos - 0.05) / 0.15;
  return 1;
}

function hexRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [176, 108, 255];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function getActivityColor(throughputBps: number): string {
  const kbps = throughputBps / 1000;
  if (kbps < 100) return "#00d4f5";
  if (kbps < 500) return lerpColor("#00d4f5", "#00ff9f", (kbps - 100) / 400);
  if (kbps < 1000) return lerpColor("#00ff9f", "#ff9f00", (kbps - 500) / 500);
  if (kbps < 5000)
    return lerpColor("#ff9f00", "#ff4545", Math.min(1, (kbps - 1000) / 4000));
  return "#cc2222";
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexRgb(c1);
  const [r2, g2, b2] = hexRgb(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function prepCanvas(cvs: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = cvs.getContext("2d");
  if (!ctx) return null;
  const dpr = 1; // Cap DPR to 1 — cable/glow shapes are soft, high DPR wastes fill-rate
  const w = cvs.clientWidth;
  const h = cvs.clientHeight;
  if (cvs.width !== w * dpr || cvs.height !== h * dpr) {
    cvs.width = w * dpr;
    cvs.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Per-frame projection cache — avoids redundant map.project() calls (cleared each frame). */
type ProjectionCache = Map<string, { x: number; y: number } | null>;

function traceCable(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  f: CableFeature,
  cLng: number,
  cLat: number,
  step: number,
  cache?: ProjectionCache,
): boolean {
  let anyVisible = false;

  for (const line of f.geometry.coordinates) {
    if (line.length < 2) continue;
    let moved = false;
    let prevLng = 0;
    let prevVis = 0;
    const last = line.length - 1;

    for (let i = 0; i <= last; i += step) {
      const idx = Math.min(i, last);
      const [lng, lat] = line[idx];
      const v = visFactor(lng, lat, cLng, cLat);

      if (v <= 0) {
        moved = false;
        prevVis = 0;
        continue;
      }
      if (moved && Math.abs(lng - prevLng) > 90) moved = false;
      if (moved && prevVis <= 0) moved = false;

      let p: { x: number; y: number } | null | undefined;
      if (cache) {
        const key = `${lng},${lat}`;
        p = cache.get(key);
        if (p === undefined) {
          const proj = map.project([lng, lat]);
          p = Number.isFinite(proj.x) && Number.isFinite(proj.y) ? proj : null;
          cache.set(key, p);
        }
      } else {
        const proj = map.project([lng, lat]);
        p = Number.isFinite(proj.x) && Number.isFinite(proj.y) ? proj : null;
      }

      if (!p) {
        moved = false;
        continue;
      }

      if (!moved) {
        ctx.moveTo(p.x, p.y);
        moved = true;
      } else {
        ctx.lineTo(p.x, p.y);
        anyVisible = true;
      }

      prevLng = lng;
      prevVis = v;
    }

    if (step > 1) {
      const [lng, lat] = line[last];
      const v = visFactor(lng, lat, cLng, cLat);
      if (v > 0 && moved && Math.abs(lng - prevLng) <= 90) {
        let p: { x: number; y: number } | null | undefined;
        if (cache) {
          const key = `${lng},${lat}`;
          p = cache.get(key);
          if (p === undefined) {
            const proj = map.project([lng, lat]);
            p =
              Number.isFinite(proj.x) && Number.isFinite(proj.y) ? proj : null;
            cache.set(key, p);
          }
        } else {
          const proj = map.project([lng, lat]);
          p = Number.isFinite(proj.x) && Number.isFinite(proj.y) ? proj : null;
        }
        if (p) {
          ctx.lineTo(p.x, p.y);
          anyVisible = true;
        }
      }
    }
  }

  return anyVisible;
}

/** Quick hemisphere check — skip cables entirely on the back of the globe. */
function isFeatureVisible(
  f: CableFeature,
  cLng: number,
  cLat: number,
): boolean {
  let sumLng = 0;
  let sumLat = 0;
  let count = 0;
  for (const line of f.geometry.coordinates) {
    if (line.length > 0) {
      const mid = line[Math.floor(line.length / 2)];
      sumLng += mid[0];
      sumLat += mid[1];
      count++;
    }
  }
  if (count === 0) return false;
  return visFactor(sumLng / count, sumLat / count, cLng, cLat) > 0;
}

const DIR_COLOR: Record<string, string> = {
  up: "#ff7a45",
  down: "#00d4f5",
  bidi: "#b06cff",
};

/** Returns true when a flow's endpoints are far enough apart to warrant cable matching. */
function needsCables(f: GeoFlow): boolean {
  if (!f.src || !f.dst || isNaN(f.src.lat) || isNaN(f.dst.lat)) return false;
  const dlat = f.src.lat - f.dst.lat;
  const dlng = f.src.lng - f.dst.lng;
  // dlat² + dlng² > 4 ≈ ~200 km at equator
  return dlat * dlat + dlng * dlng > 4;
}

export const NetworkMap = () => {
  const mapDiv = useRef<HTMLDivElement>(null);
  const staticCvs = useRef<HTMLCanvasElement>(null);
  const animCvs = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const cablesRef = useRef<CableCollection | null>(null);
  const perFlowCablesRef = useRef<Map<string, Set<string>>>(new Map());
  const cableActivityRef = useRef<Map<string, CableActivity>>(new Map());
  const cableThroughputRef = useRef<Map<string, number>>(new Map());
  const rafRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const idleFramesRef = useRef(0);
  const tickFnRef = useRef<((ts: number) => void) | null>(null);
  const cablesLoadingRef = useRef(false);
  const lastMatchRef = useRef(0);

  const flows = useTelemetryStore((s) => s.flows);

  const updateActivityTracking = useCallback(
    (fList: GeoFlow[], now: number) => {
      const activity = cableActivityRef.current;
      const throughput = cableThroughputRef.current;
      const perFlow = perFlowCablesRef.current;

      throughput.clear();

      for (const flow of fList) {
        const flowCables = perFlow.get(flow.id);
        if (!flowCables) continue;
        for (const cableId of flowCables) {
          throughput.set(cableId, (throughput.get(cableId) ?? 0) + flow.bps);
        }
      }

      for (const [cableId, bps] of throughput) {
        const existing = activity.get(cableId);
        if (existing) {
          existing.lastSeen = now;
          existing.throughput = bps;
          existing.targetOpacity = 1;
        } else {
          activity.set(cableId, {
            lastSeen: now,
            throughput: bps,
            opacity: 0.1,
            targetOpacity: 1,
          });
        }
      }

      const toRemove: string[] = [];
      for (const [cableId, state] of activity) {
        if (!throughput.has(cableId)) {
          const age = now - state.lastSeen;
          if (age > FADE_START_DELAY) {
            state.targetOpacity =
              1 - Math.min(1, (age - FADE_START_DELAY) / FADE_OUT_DURATION);
          }
          if (
            state.opacity < MIN_OPACITY &&
            state.targetOpacity < MIN_OPACITY
          ) {
            toRemove.push(cableId);
          }
        }
      }

      for (const id of toRemove) activity.delete(id);
    },
    [],
  );

  const updateOpacities = useCallback((deltaMs: number) => {
    const activity = cableActivityRef.current;
    const fadeSpeed = 3 / 1000;

    for (const state of activity.values()) {
      if (state.opacity !== state.targetOpacity) {
        const diff = state.targetOpacity - state.opacity;
        const change = Math.sign(diff) * fadeSpeed * deltaMs;
        state.opacity =
          Math.abs(change) >= Math.abs(diff)
            ? state.targetOpacity
            : Math.max(0, Math.min(1, state.opacity + change));
      }
    }
  }, []);

  const drawStatic = useCallback(
    (map: maplibregl.Map, cvs: HTMLCanvasElement, fList: GeoFlow[]) => {
      const ctx = prepCanvas(cvs);
      if (!ctx) return;
      const { lng: cLng, lat: cLat } = map.getCenter();
      const cables = cablesRef.current;
      const activity = cableActivityRef.current;

      if (cables && cables.features.length > 0) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (const f of cables.features) {
          if (activity.has(f.properties.feature_id)) continue;
          if (!isFeatureVisible(f, cLng, cLat)) continue;
          traceCable(ctx, map, f, cLng, cLat, 3);
        }
        ctx.strokeStyle = "#1a4a72";
        ctx.lineWidth = 0.7;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
      const srcSeen = new Set<string>();

      for (const f of fList) {
        if (!f.src || !f.dst || isNaN(f.src.lat) || isNaN(f.dst.lat)) continue;

        const sk = `${f.src.lat.toFixed(1)}_${f.src.lng.toFixed(1)}`;
        const sv = visFactor(f.src.lng, f.src.lat, cLng, cLat);
        if (!srcSeen.has(sk) && sv > 0) {
          srcSeen.add(sk);
          const p = map.project([f.src.lng, f.src.lat]);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

          ctx.globalAlpha = sv;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.05)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(255,255,255,0.35)";
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        const dv = visFactor(f.dst.lng, f.dst.lat, cLng, cLat);
        if (dv > 0) {
          const p = map.project([f.dst.lng, f.dst.lat]);
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

          const c = DIR_COLOR[f.dir] ?? "#b06cff";
          const [r, g, b] = hexRgb(c);
          ctx.globalAlpha = dv;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r},${g},${b},0.10)`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = c;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    },
    [],
  );

  const drawActive = useCallback(
    (
      map: maplibregl.Map,
      cvs: HTMLCanvasElement,
      ts: number,
      deltaMs: number,
    ) => {
      updateOpacities(deltaMs);

      const ctx = prepCanvas(cvs);
      if (!ctx) return;

      const cables = cablesRef.current;
      const activity = cableActivityRef.current;
      const throughput = cableThroughputRef.current;

      if (!cables || activity.size === 0) return;

      const { lng: cLng, lat: cLat } = map.getCenter();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Per-frame projection cache — traceCable is called 3× per active cable
      const projCache: ProjectionCache = new Map();

      for (const f of cables.features) {
        const featureId = f.properties.feature_id;
        const state = activity.get(featureId);
        if (!state || state.opacity < MIN_OPACITY) continue;
        if (!isFeatureVisible(f, cLng, cLat)) continue;

        const bps = throughput.get(featureId) ?? state.throughput;
        const color = getActivityColor(bps);
        const [r, g, b] = hexRgb(color);
        const baseOpacity = state.opacity;

        ctx.beginPath();
        const hasVisible = traceCable(ctx, map, f, cLng, cLat, 1, projCache);
        if (!hasVisible) continue;

        ctx.strokeStyle = `rgba(${r},${g},${b},${0.08 * baseOpacity})`;
        ctx.lineWidth = 6;
        ctx.setLineDash([]);
        ctx.stroke();

        ctx.beginPath();
        traceCable(ctx, map, f, cLng, cLat, 1, projCache);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.6 * baseOpacity})`;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([]);
        ctx.stroke();

        const speedFactor = Math.min(2, 1 + bps / 1_000_000);
        const dashLen = 5,
          gapLen = 16;
        const offset = (ts * 0.04 * speedFactor) % (dashLen + gapLen);

        ctx.beginPath();
        traceCable(ctx, map, f, cLng, cLat, 1, projCache);
        ctx.setLineDash([dashLen, gapLen]);
        ctx.lineDashOffset = -offset;
        ctx.strokeStyle = `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)},${0.4 * baseOpacity})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    [updateOpacities],
  );

  useEffect(() => {
    if (!mapDiv.current || !staticCvs.current || !animCvs.current) return;

    let initialCenter: [number, number] = [40, 20];

    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: STYLE_DARK,
      center: initialCenter,
      zoom: 2.0,
      minZoom: 1.2,
      maxZoom: 18,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 0,
      maxTileCacheSize: 16,
      canvasContextAttributes: { antialias: false },
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: true }),
      "bottom-right",
    );

    map.on("style.load", () => {
      map.setProjection({ type: "globe" });
    });

    map.on("load", async () => {
      const cur = useTelemetryStore.getState().flows;
      drawStatic(map, staticCvs.current!, cur);

      try {
        const res = await fetch("https://ipapi.co/json/");
        const data = await res.json();
        if (data.latitude && data.longitude) {
          map.flyTo({
            center: [data.longitude, data.latitude],
            zoom: 3,
            duration: 1500,
          });
        }
      } catch {}

      let lastTs = performance.now();
      const MAX_IDLE_FRAMES = 90; // ~3s at 30fps before sleeping

      const tick = (ts: number) => {
        const deltaMs = ts - lastTs;

        // 30fps cap — skip frame if <33ms since last draw
        if (deltaMs < 33) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        // Clamp delta to avoid massive jumps after tab switch / wake
        const cappedDelta = Math.min(deltaMs, 200);
        lastTs = ts;
        lastFrameTimeRef.current = ts;

        const activity = cableActivityRef.current;
        if (activity.size === 0) {
          idleFramesRef.current++;
          if (idleFramesRef.current > MAX_IDLE_FRAMES) {
            // Clear animation canvas and sleep — flows useEffect will wake us
            if (animCvs.current) {
              const sleepCtx = animCvs.current.getContext("2d");
              if (sleepCtx)
                sleepCtx.clearRect(
                  0,
                  0,
                  animCvs.current.width,
                  animCvs.current.height,
                );
            }
            rafRef.current = 0;
            return;
          }
        } else {
          idleFramesRef.current = 0;
        }

        if (animCvs.current) drawActive(map, animCvs.current, ts, cappedDelta);
        rafRef.current = requestAnimationFrame(tick);
      };

      tickFnRef.current = tick;
      rafRef.current = requestAnimationFrame(tick);
    });

    const redrawOnMove = () => {
      if (!staticCvs.current) return;
      drawStatic(map, staticCvs.current, useTelemetryStore.getState().flows);

      // Sync active cable canvas with static canvas on every map transform
      // to prevent active cables lagging behind during pan/rotate/zoom.
      if (animCvs.current && cableActivityRef.current.size > 0) {
        const now = performance.now();
        const dt = Math.min(now - lastFrameTimeRef.current, 200);
        lastFrameTimeRef.current = now;
        drawActive(map, animCvs.current, now, dt);
      }
    };
    map.on("move", redrawOnMove);
    map.on("resize", redrawOnMove);

    const handleNorthUp = () => {
      map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    };
    window.addEventListener("abyss:north-up", handleNorthUp);

    const handleThemeChange = (e: Event) => {
      const { darkMode } = (e as CustomEvent<{ darkMode: boolean }>).detail;
      const newStyle = darkMode ? STYLE_DARK : STYLE_LIGHT;
      map.setStyle(newStyle);
      map.once("style.load", () => {
        map.setProjection({ type: "globe" });
      });
    };
    window.addEventListener("abyss:theme-change", handleThemeChange);

    // Pause animation loop when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      } else if (tickFnRef.current && rafRef.current === 0) {
        idleFramesRef.current = 0;
        rafRef.current = requestAnimationFrame(tickFnRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    mapRef.current = map;

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      tickFnRef.current = null;
      window.removeEventListener("abyss:north-up", handleNorthUp);
      window.removeEventListener("abyss:theme-change", handleThemeChange);
      document.removeEventListener("visibilitychange", handleVisibility);
      map.remove();
      mapRef.current = null;
    };
  }, [drawStatic, drawActive]);

  const updateActive = useCallback(
    (fList: GeoFlow[], now: number = performance.now()) => {
      if (!cablesRef.current) return;

      const eps: FlowEndpointsWithId[] = fList
        .filter((f) => f.src && f.dst && !isNaN(f.src.lat) && !isNaN(f.dst.lat))
        .map((f) => ({
          flowId: f.id,
          srcLng: f.src.lng,
          srcLat: f.src.lat,
          dstLng: f.dst.lng,
          dstLat: f.dst.lat,
        }));

      const perFlow = matchFlowsPerFlow(eps, cablesRef.current);
      perFlowCablesRef.current = perFlow;
      updateActivityTracking(fList, now);
    },
    [updateActivityTracking],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !staticCvs.current) return;

    if (!cablesRef.current && !cablesLoadingRef.current) {
      if (flows.some(needsCables)) {
        cablesLoadingRef.current = true;
        loadCables().then((cables) => {
          // Guard against unmount during async load
          if (!mapRef.current) {
            cablesLoadingRef.current = false;
            return;
          }
          cablesRef.current = cables;
          cablesLoadingRef.current = false;

          // Run first match + redraw after cables arrive
          const cur = useTelemetryStore.getState().flows;
          const now = performance.now();
          lastMatchRef.current = now;
          updateActive(cur, now);
          if (staticCvs.current) {
            drawStatic(mapRef.current, staticCvs.current, cur);
          }

          // Wake rAF if new cable activity detected
          if (
            rafRef.current === 0 &&
            cableActivityRef.current.size > 0 &&
            tickFnRef.current
          ) {
            idleFramesRef.current = 0;
            rafRef.current = requestAnimationFrame(tickFnRef.current);
          }
        });
      }
    }

    const now = performance.now();
    if (now - lastMatchRef.current >= 500) {
      lastMatchRef.current = now;
      updateActive(flows, now);
    }

    drawStatic(map, staticCvs.current, flows);

    // Wake up rAF loop if it was sleeping and we now have active cables
    if (
      rafRef.current === 0 &&
      cableActivityRef.current.size > 0 &&
      tickFnRef.current
    ) {
      idleFramesRef.current = 0;
      rafRef.current = requestAnimationFrame(tickFnRef.current);
    }
  }, [flows, drawStatic, updateActive]);

  const canvasStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  };

  return (
    <div className="network-map" style={{ position: "relative" }}>
      <div ref={mapDiv} style={{ position: "absolute", inset: 0 }} />
      <canvas ref={staticCvs} style={{ ...canvasStyle, zIndex: 1 }} />
      <canvas ref={animCvs} style={{ ...canvasStyle, zIndex: 2 }} />
    </div>
  );
};
