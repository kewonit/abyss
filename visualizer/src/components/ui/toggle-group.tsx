import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TGCtx = createContext({ value: "", onChange: (_v: string) => {} });

function ToggleGroup({
  value,
  onValueChange,
  defaultValue,
  children,
  className,
  ...props
}: {
  type?: "single";
  value?: string;
  onValueChange?: (v: string) => void;
  defaultValue?: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const [internal, setInternal] = useState(defaultValue || "");
  return (
    <TGCtx.Provider value={{ value: value ?? internal, onChange: onValueChange || setInternal }}>
      <div
        role="group"
        className={cn(
          "inline-flex items-center gap-0.5 rounded-lg bg-[rgba(var(--ui-fg),0.04)] p-0.5",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </TGCtx.Provider>
  );
}

function ToggleGroupItem({
  value,
  children,
  className,
  ...props
}: {
  value: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const ctx = useContext(TGCtx);
  const active = ctx.value === value;
  return (
    <button
      type="button"
      data-state={active ? "on" : "off"}
      onClick={() => ctx.onChange(value)}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-[13px] font-mono px-2 h-6 transition-colors",
        "text-[rgba(var(--ui-fg),0.4)] hover:text-[rgba(var(--ui-fg),0.7)] hover:bg-[rgba(var(--ui-fg),0.06)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent-cyan)",
        active &&
          "text-(--accent-cyan) bg-(--accent-cyan)/15 shadow-[0_0_8px_rgba(0,212,245,0.15)]",
        "disabled:pointer-events-none disabled:opacity-50",
        "cursor-pointer select-none",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export { ToggleGroup, ToggleGroupItem };
