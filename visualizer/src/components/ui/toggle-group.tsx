import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

const ToggleGroup = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn(
      "inline-flex items-center gap-0.5 rounded-lg bg-[rgba(var(--ui-fg),0.04)] p-0.5",
      className
    )}
    {...props}
  />
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded-md text-[13px] font-mono px-2 h-6 transition-colors",
      "text-[rgba(var(--ui-fg),0.4)] hover:text-[rgba(var(--ui-fg),0.7)] hover:bg-[rgba(var(--ui-fg),0.06)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent-cyan) focus-visible:ring-offset-1 focus-visible:ring-offset-(--page-bg)",
      "data-[state=on]:text-(--accent-cyan) data-[state=on]:bg-(--accent-cyan)/15 data-[state=on]:shadow-[0_0_8px_rgba(0,212,245,0.15)]",
      "disabled:pointer-events-none disabled:opacity-50",
      "cursor-pointer select-none",
      className
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
