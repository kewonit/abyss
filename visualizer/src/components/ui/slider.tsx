import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  className,
  style,
  ...props
}: {
  value?: number[];
  onValueChange?: (v: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const current = value?.[0] ?? min;
  const pct = max > min ? ((current - min) / (max - min)) * 100 : 0;

  return (
    <div
      className={cn("relative flex w-full touch-none select-none items-center", className)}
      style={style}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        disabled={disabled}
        onChange={(e) => onValueChange?.([Number((e.target as HTMLInputElement).value)])}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        {...props}
      />
      <div className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[rgba(var(--ui-fg),0.08)]">
        <div
          className="absolute h-full rounded-full bg-(--accent-cyan)"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className="absolute h-3.5 w-3.5 rounded-full border-2 border-(--accent-cyan) bg-(--page-bg) shadow-[0_0_6px_rgba(0,212,245,0.4)] pointer-events-none"
        style={{ left: `calc(${pct}% - 7px)` }}
      />
    </div>
  );
}

export { Slider };
