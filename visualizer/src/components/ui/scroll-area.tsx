import type { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

function ScrollArea({
  className,
  children,
  style,
}: {
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className={cn("overflow-auto", className)} style={style}>
      {children}
    </div>
  );
}

export { ScrollArea };
