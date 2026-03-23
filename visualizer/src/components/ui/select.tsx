import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const SelectCtx = createContext({
  value: "",
  onChange: (_v: string) => {},
  open: false,
  setOpen: (_v: boolean) => {},
});

function Select({
  value,
  onValueChange,
  children,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SelectCtx.Provider
      value={{
        value: value ?? "",
        onChange: (v) => {
          onValueChange?.(v);
          setOpen(false);
        },
        open,
        setOpen,
      }}
    >
      <div className="relative">{children}</div>
    </SelectCtx.Provider>
  );
}

function SelectTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useContext(SelectCtx);
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[13px]",
        "bg-[rgba(var(--ui-fg),0.04)] border border-[rgba(var(--ui-fg),0.08)] text-[rgba(var(--ui-fg),0.8)]",
        "hover:bg-[rgba(var(--ui-fg),0.06)] transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-[var(--accent-cyan)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "[&>span]:line-clamp-1",
        className
      )}
    >
      {children}
      <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
    </button>
  );
}

function SelectValue({ children }: { children?: ReactNode; placeholder?: string }) {
  return <span>{children}</span>;
}

function SelectContent({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen } = useContext(SelectCtx);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 mt-1 max-h-72 min-w-[8rem] w-full overflow-auto rounded-xl p-1 shadow-lg",
        "bg-[rgba(var(--ui-bg),0.92)] border border-[rgba(var(--ui-fg),0.08)] backdrop-blur-xl",
        "animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      {children}
    </div>
  );
}

function SelectItem({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(SelectCtx);
  const selected = ctx.value === value;
  return (
    <div
      onClick={() => ctx.onChange(value)}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-2 pr-8 text-[13px] outline-none",
        "text-[rgba(var(--ui-fg),0.7)] hover:bg-[rgba(var(--ui-fg),0.06)] hover:text-[rgba(var(--ui-fg),0.9)]",
        className
      )}
    >
      {selected && (
        <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
      <span>{children}</span>
    </div>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
