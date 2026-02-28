import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "default"
    | "secondary"
    | "ghost"
    | "destructive"
    | "outline"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page-bg)]",
          "disabled:pointer-events-none disabled:opacity-50",
          "active:scale-[0.97] transition-transform duration-100",
          "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
          // variants
          variant === "default" &&
            "bg-[var(--accent-cyan)] text-[#010108] hover:bg-[var(--accent-cyan)]/90 shadow-sm",
          variant === "secondary" &&
            "bg-[rgba(var(--ui-fg),0.06)] text-[rgba(var(--ui-fg),0.9)] hover:bg-[rgba(var(--ui-fg),0.1)]",
          variant === "ghost" &&
            "text-[rgba(var(--ui-fg),0.6)] hover:bg-[rgba(var(--ui-fg),0.06)] hover:text-[rgba(var(--ui-fg),0.9)]",
          variant === "destructive" &&
            "bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red)]/90 shadow-sm",
          variant === "outline" &&
            "border border-[rgba(var(--ui-fg),0.08)] bg-transparent text-[rgba(var(--ui-fg),0.7)] hover:bg-[rgba(var(--ui-fg),0.04)] hover:text-[rgba(var(--ui-fg),0.9)]",
          variant === "link" &&
            "text-[var(--accent-cyan)] underline-offset-4 hover:underline",
          // sizes
          size === "default" && "h-9 px-4 py-2",
          size === "sm" && "h-7 rounded-md px-3 text-xs",
          size === "lg" && "h-10 rounded-lg px-6",
          size === "icon" && "h-8 w-8 rounded-lg",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
