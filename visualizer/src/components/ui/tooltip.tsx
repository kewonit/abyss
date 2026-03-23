import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function TooltipProvider({ children }: { children: ReactNode; delayDuration?: number }) {
  return <>{children}</>;
}

function Tooltip({ children }: { children: ReactNode }) {
  return <span className="relative inline-flex group/tip">{children}</span>;
}

function TooltipTrigger({ children }: { children: ReactNode; asChild?: boolean }) {
  return <>{children}</>;
}

function TooltipContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  sideOffset?: number;
  side?: string;
}) {
  return (
    <span
      className={cn(
        "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 px-3 py-1.5 text-[13px] font-medium rounded-lg whitespace-nowrap",
        "bg-[rgba(var(--ui-bg),0.9)] text-[rgba(var(--ui-fg),0.85)] border border-[rgba(var(--ui-fg),0.08)]",
        "backdrop-blur-xl shadow-md",
        "opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity duration-150",
        className
      )}
    >
      {children}
    </span>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
