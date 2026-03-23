import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TabsCtx = createContext({ value: "", onChange: (_v: string) => {} });

function Tabs({
  value,
  onValueChange,
  defaultValue,
  children,
  className,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  defaultValue?: string;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState(defaultValue || "");
  return (
    <TabsCtx.Provider value={{ value: value ?? internal, onChange: onValueChange || setInternal }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-9 items-center justify-center rounded-lg p-1 gap-1",
        "bg-[rgba(var(--ui-fg),0.04)] text-[rgba(var(--ui-fg),0.5)]",
        className
      )}
    >
      {children}
    </div>
  );
}

function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsCtx);
  const active = ctx.value === value;
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx.onChange(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)]",
        "disabled:pointer-events-none disabled:opacity-50",
        active
          ? "bg-[rgba(var(--ui-fg),0.08)] text-[rgba(var(--ui-fg),0.9)] shadow-sm"
          : "hover:text-[rgba(var(--ui-fg),0.7)]",
        className
      )}
    >
      {children}
    </button>
  );
}

function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsCtx);
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={cn("mt-2 animate-in fade-in-0 duration-200", className)}>
      {children}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
