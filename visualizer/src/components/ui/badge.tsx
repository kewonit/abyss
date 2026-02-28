import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"
    | "secondary"
    | "destructive"
    | "outline"
    | "recording"
    | "success"
    | "warning";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-[var(--accent-cyan)] focus:ring-offset-2",
        variant === "default" &&
          "bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border border-[var(--accent-cyan)]/20",
        variant === "secondary" &&
          "bg-[rgba(var(--ui-fg),0.06)] text-[rgba(var(--ui-fg),0.7)] border border-[rgba(var(--ui-fg),0.08)]",
        variant === "destructive" &&
          "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20",
        variant === "outline" &&
          "border border-[rgba(var(--ui-fg),0.1)] text-[rgba(var(--ui-fg),0.6)]",
        variant === "recording" &&
          "bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/20 animate-pulse",
        variant === "success" &&
          "bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20",
        variant === "warning" &&
          "bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] border border-[var(--accent-amber)]/20",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
