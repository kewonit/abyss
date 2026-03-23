import { cn } from "@/lib/utils";

function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  id,
}: {
  checked?: boolean;
  onCheckedChange?: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      role="switch"
      type="button"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-cyan-500" : "bg-white/20",
        className
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

export { Switch };
