import type { GeoFlow } from "./schema";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CablePath {
  id: string;
  name: string;
  color: string;
  coords: number[][]; // [[lng, lat], ...]
}

// ─── Cache ──────────────────────────────────────────────────────────────────

let _cache: CablePath[] | null = null;
let _grid: SpatialGrid | null = null;

export function releaseCables(): void {
  _cache = null;
  _grid = null;
}

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loadCablePaths(): Promise<CablePath[]> {
  if (_cache) return _cache;

  try {
    let raw: {
      features: {
        properties: { feature_id: string; name: string; color: string };
        geometry: { coordinates: number[][][] };
      }[];
    };

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      raw = JSON.parse(await invoke<string>("fetch_cables"));
    } catch {
      const res = await fetch("https://www.submarinecablemap.com/api/v3/cable/cable-geo.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    }

    const paths: CablePath[] = [];
    for (const f of raw.features) {
      for (const coords of f.geometry.coordinates) {
        paths.push({
          id: f.properties.feature_id,
          name: f.properties.name,
          color: f.properties.color,
          coords,
        });
      }
    }

    _cache = paths;
    _grid = buildSpatialGrid(paths);
    return paths;
  } catch (err) {
    console.warn("[Cables] Load failed:", err);
    return [];
  }
}

// ─── Spatial Grid Index ─────────────────────────────────────────────────────
// Cells are 10° × 10° bins. Each cell stores cable IDs whose coordinates
// pass through it. Lookup is O(1) per cell instead of scanning all cables.

const CELL_SIZE = 10; // degrees

interface SpatialGrid {
  cells: Map<string, Set<string>>; // "latBin_lngBin" → Set<cableId>
}

function cellKey(lat: number, lng: number): string {
  const latBin = Math.floor(lat / CELL_SIZE);
  const lngBin = Math.floor(lng / CELL_SIZE);
  return `${latBin}_${lngBin}`;
}

function buildSpatialGrid(cables: CablePath[]): SpatialGrid {
  const cells = new Map<string, Set<string>>();
  for (const cable of cables) {
    // Sample every Nth coordinate to keep index small
    const step = Math.max(1, Math.floor(cable.coords.length / 50));
    for (let i = 0; i < cable.coords.length; i += step) {
      const pt = cable.coords[i];
      const key = cellKey(pt[1], pt[0]); // coords are [lng, lat]
      let set = cells.get(key);
      if (!set) {
        set = new Set();
        cells.set(key, set);
      }
      set.add(cable.id);
    }
  }
  return { cells };
}

/** Get cable IDs within ±threshold degrees of a point. */
function getCandidates(
  grid: SpatialGrid,
  lat: number,
  lng: number,
  thresholdDeg: number
): Set<string> {
  const result = new Set<string>();
  const radius = Math.ceil(thresholdDeg / CELL_SIZE);
  const baseLat = Math.floor(lat / CELL_SIZE);
  const baseLng = Math.floor(lng / CELL_SIZE);

  for (let dLat = -radius; dLat <= radius; dLat++) {
    for (let dLng = -radius; dLng <= radius; dLng++) {
      const key = `${baseLat + dLat}_${baseLng + dLng}`;
      const set = grid.cells.get(key);
      if (set) for (const id of set) result.add(id);
    }
  }
  return result;
}

// ─── Matching (grid-accelerated) ────────────────────────────────────────────

const DEG = Math.PI / 180;
const R = 6371;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns IDs of cables likely routing traffic for active flows.
 * Uses spatial grid for O(1) candidate lookup instead of scanning all cables.
 */
export function matchActiveCables(flows: GeoFlow[], cables: CablePath[]): Set<string> {
  const grid = _grid;
  if (!grid) return new Set();

  const active = new Set<string>();
  // Build cable lookup map (only for candidates we'll actually check)
  const cableMap = new Map<string, CablePath>();
  for (const c of cables) cableMap.set(c.id, c);

  for (const f of flows) {
    if (!f.src || !f.dst || isNaN(f.src.lat) || isNaN(f.dst.lat)) continue;

    const directDist = haversine(f.src.lat, f.src.lng, f.dst.lat, f.dst.lng);
    if (directDist < 400) continue;

    const thresholdKm = Math.max(100, Math.min(300, directDist * 0.15));
    // Convert km threshold to approximate degrees for grid lookup
    const thresholdDeg = thresholdKm / 111;

    // Grid lookup: candidates near src AND dst
    const nearSrc = getCandidates(grid, f.src.lat, f.src.lng, thresholdDeg);
    const nearDst = getCandidates(grid, f.dst.lat, f.dst.lng, thresholdDeg);

    // Intersection: cables that appear in both src and dst neighborhoods
    for (const id of nearSrc) {
      if (active.has(id)) continue;
      if (!nearDst.has(id)) continue;

      // Verify with actual haversine on sampled points
      const cable = cableMap.get(id);
      if (!cable) continue;

      let confirmedSrc = false;
      let confirmedDst = false;
      const step = Math.max(1, Math.floor(cable.coords.length / 30));

      for (let i = 0; i < cable.coords.length; i += step) {
        const pt = cable.coords[i];
        if (!confirmedSrc && haversine(f.src.lat, f.src.lng, pt[1], pt[0]) < thresholdKm)
          confirmedSrc = true;
        if (!confirmedDst && haversine(f.dst.lat, f.dst.lng, pt[1], pt[0]) < thresholdKm)
          confirmedDst = true;
        if (confirmedSrc && confirmedDst) {
          active.add(id);
          break;
        }
      }
    }
  }

  return active;
}
