import { useEffect } from "react";
import { NetworkMap } from "./components/NetworkMap";
import { TopBar } from "./components/TopBar";
import { StatsPanel } from "./components/StatsPanel";
import { useTelemetryStore } from "./telemetry/store";
import type { TelemetryFrame } from "./telemetry/schema";

export default function App() {
  const ingestFrame = useTelemetryStore((s) => s.ingestFrame);
  const setConnected = useTelemetryStore((s) => s.setConnected);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let active = true;

    setConnected(false);

    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (!active) return;
        listen<TelemetryFrame>("telemetry-frame", (event) => {
          ingestFrame(event.payload);
          setConnected(true);
        }).then((unlisten) => {
          if (active) cleanup = unlisten;
          else unlisten();
        });
      })
      .catch(() => {
        if (active) setConnected(false);
      });

    return () => {
      active = false;
      cleanup?.();
    };
  }, [ingestFrame, setConnected]);

  return (
    <div className="app-root">
      <NetworkMap />
      <div className="overlay-ui">
        <StatsPanel />
        <TopBar />
      </div>
    </div>
  );
}
