import { useRef, useEffect, useState } from "react";
import Globe, { type GlobeInstance } from "globe.gl";
import { useTelemetryStore } from "../telemetry/store";
import { loadCablePaths, matchActiveCables, type CablePath } from "../telemetry/cables";
import type { GeoFlow } from "../telemetry/schema";
import { formatDataRate } from "../lib/utils";

// ─── Constants ──────────────────────────────────────────────────────────────

const DIR_COLORS = { up: "#ff7a45", down: "#00d4f5", bidi: "#b06cff" } as const;
const INACTIVE_CABLE = "rgba(255,255,255,0.07)";
const EARTH_IMG = "//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg";
const CABLE_THROTTLE_MS = 3000; // only re-match cables every 3s
const IDLE_PAUSE_MS = 5000; // pause render loop after 5s of no data

// ─── Flow fingerprint — skip globe updates when nothing changed ─────────

function flowFingerprint(flows: GeoFlow[]): string {
  if (flows.length === 0) return "";
  // Fast hash: id + truncated coords. Avoids full JSON serialization.
  let h = "";
  for (const f of flows) {
    h += f.id;
    h += f.dst.lat.toFixed(1);
    h += f.dst.lng.toFixed(1);
  }
  return h;
}

// ─── Tooltip ────────────────────────────────────────────────────────────────

interface TooltipData {
  x: number;
  y: number;
  ip: string;
  city?: string;
  country?: string;
  bps: number;
  rtt: number;
  service?: string;
  dir: string;
}

function FlowTooltip({ x, y, ip, city, country, bps, rtt, service, dir }: TooltipData) {
  return (
    <div
      className="absolute pointer-events-none z-50 bg-black/90 border border-white/10 rounded-lg px-3 py-2 text-xs max-w-[220px] shadow-lg"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="font-semibold text-white">{city || ip}</div>
      {city && <div className="text-white/40 font-mono text-[10px]">{ip}</div>}
      <div className="mt-1 flex gap-2">
        <span className="text-cyan-400">{formatDataRate(bps)}</span>
        {rtt > 0 && <span className="text-amber-400">{rtt.toFixed(0)}ms</span>}
      </div>
      {service && <div className="text-white/50 mt-0.5">{service}</div>}
      <div className="text-white/30 mt-0.5">
        {country || "Unknown"} ·{" "}
        {dir === "up" ? "↑ Upload" : dir === "down" ? "↓ Download" : "↕ Bidi"}
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NetworkMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const cablesRef = useRef<CablePath[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const lastFpRef = useRef(""); // flow fingerprint
  const lastCableMatchRef = useRef(0); // timestamp of last cable matching
  const cachedCableIdsRef = useRef<Set<string>>(new Set());
  const idleTimerRef = useRef<number | undefined>();
  const isPausedRef = useRef(false);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  // ── Globe initialization ────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const globe = new Globe(el, {
      rendererConfig: { antialias: true, alpha: false },
      animateIn: false,
    })
      .globeImageUrl(EARTH_IMG)
      .backgroundColor("#080810")
      .showAtmosphere(true)
      .atmosphereColor("rgba(100,180,255,0.15)")
      .atmosphereAltitude(0.12)
      .width(el.clientWidth)
      .height(el.clientHeight)
      // Points — zero transition for instant updates
      .pointLat((d: any) => d.lat)
      .pointLng((d: any) => d.lng)
      .pointRadius((d: any) => d.size)
      .pointColor((d: any) => d.color)
      .pointAltitude(0.01)
      .pointsMerge(true) // merge points into single geometry = much less GPU draw calls
      .pointsTransitionDuration(0)
      .onPointHover((point: any) => {
        if (!point?.flow) {
          setTooltip(null);
          return;
        }
        const f = point.flow;
        setTooltip({
          x: mouseRef.current.x,
          y: mouseRef.current.y,
          ip: f.dst.ip,
          city: f.dst.city,
          country: f.dst.country,
          bps: f.bps,
          rtt: f.rtt,
          service: f.service,
          dir: f.dir,
        });
      })
      // Arcs — zero transition
      .arcStartLat((d: any) => d.srcLat)
      .arcStartLng((d: any) => d.srcLng)
      .arcEndLat((d: any) => d.dstLat)
      .arcEndLng((d: any) => d.dstLng)
      .arcColor((d: any) => d.color)
      .arcAltitudeAutoScale(0.3)
      .arcStroke(0.5)
      .arcDashLength(0.4)
      .arcDashGap(0.2)
      .arcDashAnimateTime(1500)
      .arcsTransitionDuration(0)
      // Paths (cables)
      .pathPoints((d: any) => d.coords)
      .pathPointLat((p: any) => p[1])
      .pathPointLng((p: any) => p[0])
      .pathStroke(0.4)
      .pathTransitionDuration(0);

    globeRef.current = globe;

    // Fly to saved POV or user's approximate location
    const savedPov = useTelemetryStore.getState().savedGlobePov;
    if (savedPov) {
      globe.pointOfView(savedPov, 0);
    } else {
      fetch("https://ipapi.co/json/")
        .then((r) => r.json())
        .then((d) => {
          if (d.latitude && d.longitude) {
            globe.pointOfView({ lat: d.latitude, lng: d.longitude, altitude: 2.5 }, 1500);
          }
        })
        .catch(() => {});
    }

    // Load submarine cables
    loadCablePaths().then((paths) => {
      cablesRef.current = paths;
      globe
        .pathsData(paths)
        .pathColor(() => INACTIVE_CABLE)
        .pathDashLength(0)
        .pathDashGap(0);
    });

    // Resize via ResizeObserver
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) globe.width(width).height(height);
    });
    ro.observe(el);

    // Cleanup
    return () => {
      ro.disconnect();
      clearTimeout(idleTimerRef.current);
      useTelemetryStore.getState().setSavedGlobePov(globe.pointOfView());
      globe.pauseAnimation();
      globe.controls().dispose();
      globe.renderer().dispose();
      el.innerHTML = "";
      globeRef.current = null;
    };
  }, []);

  // ── Reactive flow data binding ──────────────────────────────────────────

  const flows = useTelemetryStore((s) => s.flows);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    // Fingerprint check — skip expensive globe updates when data is unchanged
    const fp = flowFingerprint(flows);
    if (fp === lastFpRef.current) return;
    lastFpRef.current = fp;

    // Wake globe if it was idling
    if (isPausedRef.current) {
      globe.resumeAnimation();
      isPausedRef.current = false;
    }

    // Reset idle timer
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (globeRef.current) {
        globeRef.current.pauseAnimation();
        isPausedRef.current = true;
      }
    }, IDLE_PAUSE_MS);

    // Build points and arcs
    const srcSeen = new Set<string>();
    const points: {
      lat: number;
      lng: number;
      size: number;
      color: string;
      flow: GeoFlow | null;
    }[] = [];
    const arcs: {
      srcLat: number;
      srcLng: number;
      dstLat: number;
      dstLng: number;
      color: [string, string];
    }[] = [];

    for (const f of flows) {
      if (!f.src || !f.dst || isNaN(f.src.lat) || isNaN(f.dst.lat)) continue;

      const sk = `${f.src.lat.toFixed(1)}_${f.src.lng.toFixed(1)}`;
      if (!srcSeen.has(sk)) {
        srcSeen.add(sk);
        points.push({ lat: f.src.lat, lng: f.src.lng, size: 0.5, color: "#ffffff", flow: null });
      }

      const c = DIR_COLORS[f.dir] || DIR_COLORS.bidi;
      points.push({
        lat: f.dst.lat,
        lng: f.dst.lng,
        size: Math.min(0.4, 0.1 + f.bps / 1_000_000),
        color: c,
        flow: f,
      });

      arcs.push({
        srcLat: f.src.lat,
        srcLng: f.src.lng,
        dstLat: f.dst.lat,
        dstLng: f.dst.lng,
        color: [`${c}99`, `${c}22`],
      });
    }

    globe.pointsData(points);
    globe.arcsData(arcs);

    // Throttled cable matching — at most once per CABLE_THROTTLE_MS
    const cables = cablesRef.current;
    if (cables.length > 0) {
      const now = Date.now();
      if (now - lastCableMatchRef.current >= CABLE_THROTTLE_MS) {
        lastCableMatchRef.current = now;
        cachedCableIdsRef.current = matchActiveCables(flows, cables);
      }
      const activeIds = cachedCableIdsRef.current;
      globe
        .pathColor((p: any) => (activeIds.has(p.id) ? `${p.color}cc` : INACTIVE_CABLE))
        .pathDashLength((p: any) => (activeIds.has(p.id) ? 0.1 : 0))
        .pathDashGap((p: any) => (activeIds.has(p.id) ? 0.008 : 0))
        .pathDashAnimateTime((p: any) => (activeIds.has(p.id) ? 12000 : 0));
    }
  }, [flows]);

  // ── Custom window events ────────────────────────────────────────────────

  useEffect(() => {
    const onNorthUp = () => {
      const globe = globeRef.current;
      if (!globe) return;
      const pov = globe.pointOfView();
      globe.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: 2.5 }, 1000);
    };
    window.addEventListener("abyss:north-up", onNorthUp);
    return () => window.removeEventListener("abyss:north-up", onNorthUp);
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseMove={(e) => {
        mouseRef.current = { x: e.clientX, y: e.clientY };
      }}
    >
      {tooltip && <FlowTooltip {...tooltip} />}
    </div>
  );
}
