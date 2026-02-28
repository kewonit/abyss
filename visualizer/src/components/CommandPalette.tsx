import React, { useEffect, useState, useCallback } from "react";
import { Command } from "cmdk";
import {
  Activity,
  BarChart3,
  Clock,
  Moon,
  Sun,
  Play,
  Square,
  Navigation,
  FolderOpen,
  Keyboard,
} from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import { startSession, stopSession } from "../telemetry/sessions";

export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const setView = useTelemetryStore((s) => s.setView);
  const setDrawerOpen = useTelemetryStore((s) => s.setDrawerOpen);
  const recording = useTelemetryStore((s) => s.recording);
  const setRecording = useTelemetryStore((s) => s.setRecording);
  const view = useTelemetryStore((s) => s.view);
  const stopPlayback = useTelemetryStore((s) => s.stopPlayback);

  // Ctrl+K opens palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      // ? also opens (when not typing)
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const run = useCallback((action: () => void) => {
    action();
    setOpen(false);
  }, []);

  const toggleDarkMode = useCallback(() => {
    const isDark = !document.body.classList.contains("light-mode");
    if (isDark) {
      document.body.classList.add("light-mode");
      localStorage.setItem("abyss:theme", "light");
    } else {
      document.body.classList.remove("light-mode");
      localStorage.setItem("abyss:theme", "dark");
    }
    window.dispatchEvent(
      new CustomEvent("abyss:theme-change", {
        detail: { darkMode: !isDark },
      }),
    );
  }, []);

  const handleNewSession = useCallback(async () => {
    try {
      if (recording) {
        await stopSession();
        setRecording(false, null);
      }
      const id = await startSession();
      setRecording(true, id);
    } catch (err) {
      console.error("Failed to start session:", err);
    }
  }, [recording, setRecording]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          className="bg-(--pill-bg) backdrop-blur-xl border border-(--pill-border) rounded-xl shadow-2xl overflow-hidden"
          label="Command palette"
        >
          <Command.Input
            placeholder="Type a command…"
            className="w-full bg-transparent text-[13px] text-[rgba(var(--ui-fg),0.85)] placeholder:text-[rgba(var(--ui-fg),0.3)] outline-none border-b border-[rgba(var(--ui-fg),0.06)]"
            style={{ padding: "12px 16px" }}
          />
          <Command.List
            className="max-h-72 overflow-y-auto"
            style={{ padding: "6px" }}
          >
            <Command.Empty className="text-[12px] text-[rgba(var(--ui-fg),0.35)] text-center py-6">
              No results found.
            </Command.Empty>

            <Command.Group
              heading="Navigation"
              className="[&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:tracking-[1.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[rgba(var(--ui-fg),0.25)] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              <PaletteItem
                icon={<Activity size={14} />}
                label="Go to Live View"
                shortcut="Esc"
                onSelect={() =>
                  run(() => {
                    if (view === "playback") stopPlayback();
                    else setView("live");
                  })
                }
              />
              <PaletteItem
                icon={<BarChart3 size={14} />}
                label="Open Analytics"
                onSelect={() => run(() => setView("analytics"))}
              />
              <PaletteItem
                icon={<Clock size={14} />}
                label="Toggle Sessions Drawer"
                shortcut="S"
                onSelect={() => run(() => setDrawerOpen(true))}
              />
            </Command.Group>

            <Command.Group
              heading="Actions"
              className="[&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:tracking-[1.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[rgba(var(--ui-fg),0.25)] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              <PaletteItem
                icon={recording ? <Square size={14} /> : <Play size={14} />}
                label={recording ? "Stop Recording" : "New Recording"}
                shortcut="Ctrl+N"
                onSelect={() => run(handleNewSession)}
              />
              <PaletteItem
                icon={<Navigation size={14} />}
                label="Reset Map Orientation"
                onSelect={() =>
                  run(() =>
                    window.dispatchEvent(new CustomEvent("abyss:north-up")),
                  )
                }
              />
            </Command.Group>

            <Command.Group
              heading="Appearance"
              className="[&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:tracking-[1.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[rgba(var(--ui-fg),0.25)] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              <PaletteItem
                icon={
                  document.body.classList.contains("light-mode") ? (
                    <Moon size={14} />
                  ) : (
                    <Sun size={14} />
                  )
                }
                label="Toggle Dark/Light Mode"
                onSelect={() => run(toggleDarkMode)}
              />
            </Command.Group>

            <Command.Group
              heading="Keyboard Shortcuts"
              className="[&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:tracking-[1.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[rgba(var(--ui-fg),0.25)] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
            >
              <PaletteItem
                icon={<Keyboard size={14} />}
                label="Ctrl+K — Command Palette"
                disabled
              />
              <PaletteItem
                icon={<Keyboard size={14} />}
                label="S — Toggle Sessions"
                disabled
              />
              <PaletteItem
                icon={<Keyboard size={14} />}
                label="Esc — Back to Live"
                disabled
              />
              <PaletteItem
                icon={<Keyboard size={14} />}
                label="Ctrl+N — New Session"
                disabled
              />
              <PaletteItem
                icon={<Keyboard size={14} />}
                label="Space — Play/Pause (Playback)"
                disabled
              />
              <PaletteItem
                icon={<Keyboard size={14} />}
                label="←/→ — Seek (Playback)"
                disabled
              />
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
};

/** Single command palette item. */
const PaletteItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
}> = ({ icon, label, shortcut, onSelect, disabled }) => (
  <Command.Item
    onSelect={disabled ? undefined : onSelect}
    className="flex items-center gap-2.5 rounded-lg cursor-pointer text-[12px] text-[rgba(var(--ui-fg),0.7)] data-[selected=true]:bg-[rgba(var(--ui-fg),0.06)] data-[selected=true]:text-[rgba(var(--ui-fg),0.95)] transition-colors duration-100"
    style={{ padding: "8px 10px" }}
    disabled={disabled}
  >
    <span className="text-[rgba(var(--ui-fg),0.4)] shrink-0">{icon}</span>
    <span className="flex-1">{label}</span>
    {shortcut && (
      <span className="text-[10px] font-mono text-[rgba(var(--ui-fg),0.25)] bg-[rgba(var(--ui-fg),0.04)] px-1.5 py-0.5 rounded">
        {shortcut}
      </span>
    )}
  </Command.Item>
);
