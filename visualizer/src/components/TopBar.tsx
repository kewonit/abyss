import React, { useEffect, useState } from "react";
import { Settings, Navigation } from "lucide-react";
import { useTelemetryStore } from "../telemetry/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Switch } from "./ui/switch";

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

export const TopBar: React.FC = () => {
  // Primitive selectors — only re-render when the actual number changes,
  // not on every frame when the parent object reference changes.
  const hasFrame = useTelemetryStore((s) => s.frame !== null);
  const bps = useTelemetryStore((s) => s.frame?.net.bps ?? 0);
  const uploadBps = useTelemetryStore((s) => s.frame?.net.uploadBps ?? 0);
  const downloadBps = useTelemetryStore((s) => s.frame?.net.downloadBps ?? 0);
  const latencyMs = useTelemetryStore((s) => s.frame?.net.latencyMs ?? 0);
  const [clock, setClock] = useState("");
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    document.body.classList.toggle("light-mode", !darkMode);
    window.dispatchEvent(
      new CustomEvent("abyss:theme-change", { detail: { darkMode } }),
    );
  }, [darkMode]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleNorthUp = () => {
    window.dispatchEvent(new CustomEvent("abyss:north-up"));
  };

  return (
    <>
      <div className="logo-bar">
        <span className="logo-text">ABYSS</span>
      </div>

      <div className="bottom-bar">
        <div className="controls-row">
          <button
            className="control-btn"
            onClick={handleNorthUp}
            title="North Up"
          >
            <Navigation size={14} style={{ transform: "rotate(-45deg)" }} />
          </button>

          <Dialog>
            <DialogTrigger asChild>
              <button className="control-btn" title="Settings">
                <Settings size={14} />
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Settings</DialogTitle>
              </DialogHeader>
              <div className="settings-content">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <span className="settings-label">Dark Mode</span>
                    <span className="settings-description">
                      Toggle between dark and light theme
                    </span>
                  </div>
                  <Switch checked={darkMode} onCheckedChange={setDarkMode} />
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <div className="pill clock-pill">
            <span className="pill-label mono">{clock}</span>
          </div>
        </div>

        {hasFrame && (
          <div className="pill metrics-pill">
            <span className="pill-metric">
              <span className="pill-metric-label">Throughput</span>
              <span className="pill-metric-value">{formatBps(bps * 8)}</span>
            </span>
            <span className="pill-divider" />
            <span className="pill-metric">
              <span className="pill-metric-label up-label">Upload</span>
              <span className="pill-metric-value accent-up">
                {formatBps(uploadBps * 8)}
              </span>
            </span>
            <span className="pill-divider" />
            <span className="pill-metric">
              <span className="pill-metric-label down-label">Download</span>
              <span className="pill-metric-value accent-down">
                {formatBps(downloadBps * 8)}
              </span>
            </span>
            <span className="pill-divider" />
            <span className="pill-metric">
              <span className="pill-metric-label">Latency</span>
              <span className="pill-metric-value accent-latency">
                {latencyMs.toFixed(0)} ms
              </span>
            </span>
          </div>
        )}
      </div>
    </>
  );
};
