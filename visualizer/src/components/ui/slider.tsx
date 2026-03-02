import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[rgba(var(--ui-fg),0.08)]">
      <SliderPrimitive.Range className="absolute h-full rounded-full bg-(--accent-cyan)" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border-2 border-(--accent-cyan) bg-(--page-bg) shadow-[0_0_6px_rgba(0,212,245,0.4)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent-cyan) focus-visible:ring-offset-2 focus-visible:ring-offset-(--page-bg) disabled:pointer-events-none disabled:opacity-50 hover:bg-(--accent-cyan)/20 cursor-pointer" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
