import React, { useEffect, useRef, useCallback } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// ─── Theme colors (extracted from CSS vars for canvas use) ──────────────────

const COLORS = {
  cyan: "#00d4f5",
  cyanFill: "rgba(0, 212, 245, 0.08)",
  orange: "#ff7a45",
  orangeFill: "rgba(255, 122, 69, 0.08)",
  green: "#2dd4a8",
  greenFill: "rgba(45, 212, 168, 0.08)",
  amber: "#ffb020",
  amberFill: "rgba(255, 176, 32, 0.08)",
  purple: "#b06cff",
  purpleFill: "rgba(176, 108, 255, 0.08)",
  red: "#ff4d6a",
  redFill: "rgba(255, 77, 106, 0.08)",
  gridLight: "rgba(255,255,255,0.04)",
  gridLightMode: "rgba(0,0,0,0.06)",
  axisText: "rgba(255,255,255,0.3)",
  axisTextLight: "rgba(0,0,0,0.35)",
};

/** Detect if we are in light mode */
function isLightMode(): boolean {
  return document.body.classList.contains("light-mode");
}

// ─── Series presets ─────────────────────────────────────────────────────────

export interface SeriesConfig {
  label: string;
  color: keyof typeof SERIES_PRESETS | string;
  /** Unit suffix shown in axis/tooltip, e.g. "Mbps", "ms" */
  unit?: string;
  /** If true, render as area under the line */
  fill?: boolean;
  /** Optional y-axis scale key (default: "y") */
  scale?: string;
  /** Line width in px (default: 1.5) */
  width?: number;
}

const SERIES_PRESETS: Record<string, { stroke: string; fill: string }> = {
  cyan: { stroke: COLORS.cyan, fill: COLORS.cyanFill },
  orange: { stroke: COLORS.orange, fill: COLORS.orangeFill },
  green: { stroke: COLORS.green, fill: COLORS.greenFill },
  amber: { stroke: COLORS.amber, fill: COLORS.amberFill },
  purple: { stroke: COLORS.purple, fill: COLORS.purpleFill },
  red: { stroke: COLORS.red, fill: COLORS.redFill },
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface UPlotChartProps {
  /** Data in uPlot format: [timestamps[], series1[], series2[], ...] */
  data: uPlot.AlignedData;
  /** Series configurations (one per data series, excluding x-axis) */
  series: SeriesConfig[];
  /** Chart height in px (default: 200) */
  height?: number;
  /**
   * If true, x-axis values are Unix epoch seconds and uPlot renders time.
   * If false, x-axis is treated as numeric (e.g. elapsed seconds).
   * Default: false.
   */
  timeAxis?: boolean;
  /** Additional y-axes config (for multi-scale) */
  extraAxes?: uPlot.Axis[];
  /** Custom scales overrides */
  scales?: uPlot.Scales;
  /** Format function for y-axis values */
  yFormat?: (rawVal: number) => string;
  /** Hide legend? */
  noLegend?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const UPlotChart: React.FC<UPlotChartProps> = ({
  data,
  series,
  height = 200,
  timeAxis = false,
  extraAxes,
  scales,
  yFormat,
  noLegend = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  const buildOpts = useCallback(
    (width: number): uPlot.Options => {
      const light = isLightMode();
      const gridColor = light ? COLORS.gridLightMode : COLORS.gridLight;
      const axisColor = light ? COLORS.axisTextLight : COLORS.axisText;

      const uSeries: uPlot.Series[] = [
        // x-axis (timestamp / numeric)
        {},
      ];

      for (const s of series) {
        const preset = SERIES_PRESETS[s.color];
        const stroke = preset ? preset.stroke : s.color;
        const fillColor = preset ? preset.fill : `${s.color}18`;

        uSeries.push({
          label: s.label,
          stroke,
          fill: s.fill !== false ? fillColor : undefined,
          width: (s.width ?? 1.5) / devicePixelRatio,
          scale: s.scale ?? "y",
          value: (_u, rawValue) =>
            rawValue == null
              ? "—"
              : `${rawValue.toFixed(1)}${s.unit ? " " + s.unit : ""}`,
        });
      }

      const axes: uPlot.Axis[] = [
        // X-axis
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 / devicePixelRatio },
          ticks: { stroke: gridColor, width: 1 / devicePixelRatio },
          font: "10px Inter, sans-serif",
          space: 60,
          ...(timeAxis
            ? {}
            : {
                values: (_u: uPlot, splits: number[]) =>
                  splits.map((v) => {
                    if (v >= 3600) {
                      const h = Math.floor(v / 3600);
                      const m = Math.floor((v % 3600) / 60);
                      return `${h}h${m > 0 ? m + "m" : ""}`;
                    }
                    if (v >= 60) return `${Math.floor(v / 60)}m`;
                    return `${Math.floor(v)}s`;
                  }),
              }),
        },
        // Y-axis
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 / devicePixelRatio },
          ticks: { stroke: gridColor, width: 1 / devicePixelRatio },
          font: "10px Inter, sans-serif",
          size: 50,
          ...(yFormat
            ? {
                values: (_u: uPlot, splits: number[]) =>
                  splits.map((v) => (Number.isFinite(v) ? yFormat(v) : "—")),
              }
            : {}),
        },
      ];

      if (extraAxes) {
        axes.push(...extraAxes);
      }

      return {
        width,
        height,
        cursor: {
          drag: { x: false, y: false },
          focus: { prox: 30 },
        },
        legend: { show: !noLegend },
        series: uSeries,
        axes,
        scales: {
          x: { time: timeAxis },
          ...(scales ?? {}),
        },
      };
    },
    [series, height, timeAxis, extraAxes, scales, yFormat, noLegend],
  );

  // Create / resize / destroy
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Guard: need at least 1 data point and matching series count
    if (
      !data ||
      data.length === 0 ||
      data[0].length === 0 ||
      data.length - 1 !== series.length
    ) {
      return;
    }

    const width = container.clientWidth;
    if (width <= 0) return;

    const opts = buildOpts(width);
    const chart = new uPlot(opts, data, container);
    chartRef.current = chart;

    // ResizeObserver for responsive width
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const newWidth = entry.contentRect.width;
        if (newWidth > 0) {
          chart.setSize({ width: newWidth, height });
        }
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
  }, [data, series, buildOpts, height]);

  // Empty state: if no data points or only 1 timestamp, show placeholder
  const hasData = data.length > 0 && data[0].length >= 2;

  return (
    <div
      ref={containerRef}
      className="uplot-wrapper w-full relative"
      style={{ minHeight: height }}
    >
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[11px] text-[rgba(var(--ui-fg),0.2)] italic">
            No data available
          </span>
        </div>
      )}
    </div>
  );
};

export { COLORS };
export default UPlotChart;
