export interface CableProperties {
  id: string;
  name: string;
  color: string;
  feature_id: string;
}

export interface CableFeature {
  type: "Feature";
  properties: CableProperties;
  /** Flat interleaved [lng,lat,lng,lat,...] per line — fewer GC objects than number[][][] */
  geometry: { type: "MultiLineString"; coordinates: Float32Array[] };
}

export interface CableCollection {
  type: "FeatureCollection";
  features: CableFeature[];
}

/** Raw GeoJSON shape before compacting coordinates to Float32Array. */
interface RawCableCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: CableProperties;
    geometry: { type: "MultiLineString"; coordinates: number[][][] };
  }[];
}

let _cache: CableCollection | null = null;

export async function loadCables(): Promise<CableCollection> {
  if (_cache) return _cache;

  try {
    let raw: RawCableCollection;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const json = await invoke<string>("fetch_cables");
      raw = JSON.parse(json);
    } catch {
      const res = await fetch(
        "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    }

    const simplified: CableCollection = {
      type: "FeatureCollection",
      features: raw.features.map((f) => ({
        type: "Feature" as const,
        properties: {
          id: f.properties.id,
          name: f.properties.name,
          color: f.properties.color,
          feature_id: f.properties.feature_id,
        },
        geometry: {
          type: "MultiLineString" as const,
          coordinates: f.geometry.coordinates.map((line) => {
            const arr = new Float32Array(line.length * 2);
            for (let i = 0; i < line.length; i++) {
              arr[i * 2] = Math.round(line[i][0] * 100) / 100;
              arr[i * 2 + 1] = Math.round(line[i][1] * 100) / 100;
            }
            return arr;
          }),
        },
      })),
    };

    _cache = simplified;
    return simplified;
  } catch (err) {
    console.warn("[Cables] Failed to load:", err);
    return { type: "FeatureCollection", features: [] };
  }
}

function hav(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface FlowEndpoints {
  srcLng: number;
  srcLat: number;
  dstLng: number;
  dstLat: number;
}

function crossTrackDistance(
  pointLat: number,
  pointLng: number,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): number {
  const R = 6371;
  const d13 = hav(startLat, startLng, pointLat, pointLng) / R;
  const t13 = bearing(startLat, startLng, pointLat, pointLng);
  const t12 = bearing(startLat, startLng, endLat, endLng);
  const dxt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R;
  return Math.abs(dxt);
}

function alongTrackPosition(
  pointLat: number,
  pointLng: number,
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
): number {
  const totalDist = hav(startLat, startLng, endLat, endLng);
  if (totalDist < 1) return 0.5;

  const distToStart = hav(startLat, startLng, pointLat, pointLng);
  const distToEnd = hav(endLat, endLng, pointLat, pointLng);

  if (distToStart + distToEnd < totalDist * 0.1) return 0.5;
  return distToStart / (distToStart + distToEnd);
}

function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dL = (lng2 - lng1) * toRad;

  const y = Math.sin(dL) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dL);

  return Math.atan2(y, x);
}

export interface FlowEndpointsWithId extends FlowEndpoints {
  flowId: string;
}

function scoreFeatureForRoute(
  f: CableFeature,
  flow: FlowEndpoints,
  directDist: number,
): {
  score: number;
  srcDist: number;
  dstDist: number;
  progressRatio: number;
} | null {
  const corridorWidth = Math.max(80, Math.min(300, directDist * 0.12));

  let minSrcDist = Infinity,
    minDstDist = Infinity;
  let srcLng = 0,
    srcLat = 0,
    dstLng = 0,
    dstLat = 0;
  let hasSrc = false,
    hasDst = false;
  let pointsInCorridor = 0,
    totalPoints = 0;

  for (const line of f.geometry.coordinates) {
    const len = line.length / 2;
    for (let i = 0; i < len; i++) {
      const lng = line[i * 2];
      const lat = line[i * 2 + 1];
      totalPoints++;

      const dS = hav(flow.srcLat, flow.srcLng, lat, lng);
      const dD = hav(flow.dstLat, flow.dstLng, lat, lng);

      if (dS < minSrcDist) {
        minSrcDist = dS;
        srcLng = lng;
        srcLat = lat;
        hasSrc = true;
      }
      if (dD < minDstDist) {
        minDstDist = dD;
        dstLng = lng;
        dstLat = lat;
        hasDst = true;
      }

      const crossDist = crossTrackDistance(
        lat,
        lng,
        flow.srcLat,
        flow.srcLng,
        flow.dstLat,
        flow.dstLng,
      );
      const alongPos = alongTrackPosition(
        lat,
        lng,
        flow.srcLat,
        flow.srcLng,
        flow.dstLat,
        flow.dstLng,
      );

      if (crossDist < corridorWidth && alongPos >= -0.05 && alongPos <= 1.05) {
        pointsInCorridor++;
      }
    }
  }

  if (totalPoints === 0 || !hasSrc || !hasDst) return null;

  const corridorRatio = pointsInCorridor / totalPoints;
  const srcPointToDst = hav(flow.dstLat, flow.dstLng, srcLat, srcLng);
  const dstPointToDst = hav(flow.dstLat, flow.dstLng, dstLat, dstLng);
  const progressRatio = (srcPointToDst - dstPointToDst) / directDist;

  const nearSource = minSrcDist < corridorWidth * 1.5;
  const nearDest = minDstDist < corridorWidth * 1.5;

  const isUseful =
    (corridorRatio >= 0.4 && progressRatio > -0.1) ||
    (nearSource && nearDest) ||
    (corridorRatio >= 0.25 && (nearSource || nearDest) && progressRatio > 0);

  if (!isUseful) return null;

  const score =
    ((minSrcDist + minDstDist) * (1.1 - corridorRatio)) /
    Math.max(0.1, progressRatio + 0.5);

  return { score, srcDist: minSrcDist, dstDist: minDstDist, progressRatio };
}

export function matchFlowsPerFlow(
  flows: FlowEndpointsWithId[],
  cables: CableCollection,
): Map<string, Set<string>> {
  const perFlowCables = new Map<string, Set<string>>();

  for (const flow of flows) {
    perFlowCables.set(flow.flowId, new Set<string>());

    const directDist = hav(flow.srcLat, flow.srcLng, flow.dstLat, flow.dstLng);
    if (directDist < 200) continue;

    const scoredFeatures: Array<{
      fid: string;
      score: number;
      srcDist: number;
      dstDist: number;
      progressRatio: number;
    }> = [];

    for (const f of cables.features) {
      const scoreResult = scoreFeatureForRoute(f, flow, directDist);
      if (scoreResult) {
        scoredFeatures.push({ fid: f.properties.feature_id, ...scoreResult });
      }
    }

    if (scoredFeatures.length === 0) continue;
    scoredFeatures.sort((a, b) => a.score - b.score);

    const selected = new Set<string>();
    const corridorWidth = Math.max(80, Math.min(300, directDist * 0.12));

    let coveredFromSrc = 0;
    let coveredToDst = directDist;

    for (const sf of scoredFeatures) {
      const improvesSource = sf.srcDist < coveredFromSrc + corridorWidth;
      const improvesDest = sf.dstDist < coveredToDst;

      if (selected.size === 0 || improvesSource || improvesDest) {
        selected.add(sf.fid);
        if (sf.srcDist < coveredFromSrc) coveredFromSrc = sf.srcDist;
        if (sf.dstDist < coveredToDst) coveredToDst = sf.dstDist;

        if (coveredFromSrc < corridorWidth && coveredToDst < corridorWidth) {
          if (selected.size >= 3 && sf.score > scoredFeatures[0].score * 2)
            break;
        }
        if (selected.size >= 8) break;
      }
    }

    const flowCables = perFlowCables.get(flow.flowId)!;
    for (const fid of selected) flowCables.add(fid);
  }

  return perFlowCables;
}
