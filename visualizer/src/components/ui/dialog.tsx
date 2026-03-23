import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type CSSProperties,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const DialogCtx = createContext({ isOpen: false, setOpen: (_v: boolean) => {} });

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DialogCtx.Provider value={{ isOpen: !!open, setOpen: (v) => onOpenChange?.(v) }}>
      {children}
    </DialogCtx.Provider>
  );
}

function DialogTrigger({ children }: { children: ReactNode; asChild?: boolean }) {
  const { setOpen } = useContext(DialogCtx);
  return (
    <span className="inline-flex" onClick={() => setOpen(true)}>
      {children}
    </span>
  );
}

function DialogContent({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { isOpen, setOpen } = useContext(DialogCtx);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isOpen && !el.open) el.showModal();
    else if (!isOpen && el.open) el.close();
  }, [isOpen]);

  return (
    <dialog
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 w-full max-w-md m-auto p-6",
        "rounded-2xl border border-white/10 bg-black/90 shadow-2xl backdrop-blur-xl",
        "backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        className
      )}
      style={style}
      onClose={() => setOpen(false)}
      onClick={(e) => {
        if (e.target === ref.current) setOpen(false);
      }}
    >
      {isOpen && (
        <>
          {children}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 p-1 rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus:outline-none"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </>
      )}
    </dialog>
  );
}

function DialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}>
      {children}
    </div>
  );
}

function DialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h2 className={cn("text-lg font-semibold tracking-tight text-white", className)}>{children}</h2>
  );
}

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle };
