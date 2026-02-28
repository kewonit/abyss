import * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-[rgba(var(--ui-fg),0.06)]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
