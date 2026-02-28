import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Shared Formatters ──────────────────────────────────────────────────────

/** Locale-aware number formatter for values > 999 (e.g. 1,234). */
const numFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return numFmt.format(n);
}

/** Format byte count (base-1024) → "1.2 KB", "3.4 MB", etc. */
export function formatDataSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1,
  );
  return `${(bytes / k ** idx).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/** Format data rate (base-1000) → "1.2 KB/s", "3.4 MB/s", etc. */
export function formatDataRate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return "0 B/s";
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} GB/s`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

/** Format bit-rate (base-1000) → "1.2 Mbps", "3.4 Gbps", etc. */
export function formatBitRate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return "0 bps";
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

/** Convert bytes-per-second to Mbps. */
export function bpsToMbps(bps: number): number {
  if (!Number.isFinite(bps)) return 0;
  return (bps * 8) / 1_000_000;
}

/** Format seconds → "2h 15m 30s", "45m 12s", "30s" */
export function formatDuration(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Format ISO timestamp → "Feb 27, 14:30" */
export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Format ISO timestamp with year → "Feb 27, 2026, 14:30" */
export function formatDateWithYear(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Format large numbers with SI prefix → "1.2K", "3.4M", "5.6G" */
export function formatCompact(value: number, unit: string): string {
  if (!Number.isFinite(value) || value < 0) return `0 ${unit}`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} G${unit}`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} M${unit}`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} K${unit}`;
  return `${value.toFixed(0)} ${unit}`;
}

/** Country code → flag emoji. */
export function countryFlag(code: string): string {
  if (!code || code.length < 2 || code === "Local") return "🌐";
  const upper = code.toUpperCase().slice(0, 2);
  try {
    return String.fromCodePoint(
      ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
    );
  } catch {
    return "🌐";
  }
}

/** Safely add two numbers that may be null/undefined/NaN. */
export function safeSum(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  return (Number.isFinite(a) ? a! : 0) + (Number.isFinite(b) ? b! : 0);
}

/** Percentage difference between two numbers. Returns Infinity if a===0 and b>0. */
export function pctDiff(a: number, b: number): number {
  if (!Number.isFinite(a)) a = 0;
  if (!Number.isFinite(b)) b = 0;
  if (a === 0 && b === 0) return 0;
  if (a === 0) return Infinity;
  return ((b - a) / a) * 100;
}

/** Relative time string: "just now", "2 min ago", "3 hours ago", "yesterday", "3 days ago", etc. */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0 || !Number.isFinite(diffMs)) return "";

  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return "just now";

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}
