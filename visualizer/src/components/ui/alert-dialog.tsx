import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

const AlertCtx = createContext({ isOpen: false, setOpen: (_v: boolean) => {} });

function AlertDialog({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  return <AlertCtx.Provider value={{ isOpen, setOpen }}>{children}</AlertCtx.Provider>;
}

function AlertDialogTrigger({ children }: { children: ReactNode; asChild?: boolean }) {
  const { setOpen } = useContext(AlertCtx);
  return (
    <span className="inline-flex" onClick={() => setOpen(true)}>
      {children}
    </span>
  );
}

function AlertDialogContent({ children, className }: { children: ReactNode; className?: string }) {
  const { isOpen, setOpen } = useContext(AlertCtx);
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
        "fixed inset-0 z-50 w-full max-w-md m-auto p-6 gap-4 grid",
        "rounded-2xl border border-[rgba(var(--ui-fg),0.08)] bg-[rgba(var(--ui-bg),0.92)] shadow-2xl backdrop-blur-xl",
        "backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        className
      )}
      onClose={() => setOpen(false)}
    >
      {isOpen && children}
    </dialog>
  );
}

function AlertDialogHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2 text-center sm:text-left", className)}>{children}</div>
  );
}

function AlertDialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2", className)}>
      {children}
    </div>
  );
}

function AlertDialogTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h2 className={cn("text-base font-semibold text-[rgba(var(--ui-fg),0.9)]", className)}>
      {children}
    </h2>
  );
}

function AlertDialogDescription({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <p className={cn("text-sm text-[rgba(var(--ui-fg),0.5)]", className)}>{children}</p>;
}

function AlertDialogAction({
  className,
  onClick,
  children,
  ...props
}: ButtonProps & { children: ReactNode }) {
  const { setOpen } = useContext(AlertCtx);
  return (
    <Button
      className={className}
      onClick={(e) => {
        (onClick as any)?.(e);
        setOpen(false);
      }}
      {...props}
    >
      {children}
    </Button>
  );
}

function AlertDialogCancel({
  className,
  children,
  ...props
}: ButtonProps & { children: ReactNode }) {
  const { setOpen } = useContext(AlertCtx);
  return (
    <Button
      variant="ghost"
      className={cn("mt-2 sm:mt-0", className)}
      onClick={() => setOpen(false)}
      {...props}
    >
      {children}
    </Button>
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
