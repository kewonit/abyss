import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[rgba(var(--ui-bg),0.92)] group-[.toaster]:text-[rgba(var(--ui-fg),0.85)] group-[.toaster]:border-[rgba(var(--ui-fg),0.08)] group-[.toaster]:shadow-lg group-[.toaster]:backdrop-blur-xl group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-[rgba(var(--ui-fg),0.5)]",
          actionButton:
            "group-[.toast]:bg-[var(--accent-cyan)] group-[.toast]:text-[#010108]",
          cancelButton:
            "group-[.toast]:bg-[rgba(var(--ui-fg),0.06)] group-[.toast]:text-[rgba(var(--ui-fg),0.6)]",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
