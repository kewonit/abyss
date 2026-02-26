# ABYSS

Real-time network traffic dashboard. Captures live connections, geolocates endpoints, and renders them on an interactive world map.

<img width="2041" height="1147" alt="Screenshot 2026-02-26 214044" src="https://github.com/user-attachments/assets/966b281a-7a9b-40e9-84de-e6097fc8409b" />

---

## Architecture

```
+--------------------------------------------------------------+
|  Tauri v2 Desktop Shell                                      |
|                                                              |
|   Rust Backend          event    React Frontend              |
|   (lib.rs)            -------->  (Vite + MapLibre GL)        |
|                                                              |
|   - netstat parser               - Interactive world map     |
|   - GeoIP resolver               - Great-circle arcs        |
|   - 1 Hz event loop              - Glassmorphism UI         |
+--------------------------------------------------------------+
```

**Rust backend** runs `netstat` every second, parses active TCP/UDP connections, batch-geolocates public IPs via [ip-api.com](http://ip-api.com), and emits a `telemetry-frame` event through Tauri's IPC.

**React frontend** subscribes to that event, updates a Zustand store, and renders:

- **MapLibre GL** map with CARTO Dark Matter tiles
- **Great-circle arcs** from local machine to each remote endpoint
- **Floating status pills** showing throughput, latency, and flow count
- **Stats sidebar** with sparklines, protocol breakdown, and active flows

---

## Quick Start

```bash
# Install frontend deps
cd visualizer && npm install && cd ..

# Run (requires Rust + Tauri CLI)
cargo tauri dev
```

Needs admin/elevated shell for `netstat` access on some systems.

---

## Stack

| Layer    | Tech                                    |
| -------- | --------------------------------------- |
| Shell    | Tauri v2                                |
| Backend  | Rust (reqwest, tokio, serde)            |
| Frontend | React 18, Vite 6, Zustand 4             |
| Map      | MapLibre GL JS, CARTO Dark Matter tiles |
| GeoIP    | ip-api.com (free, no key)               |

---

## Structure

```
abyss/
├── tauri-host/src-tauri/
│   └── src/lib.rs          # Traffic monitor + Tauri event emitter
├── visualizer/src/
│   ├── App.tsx              # Root - Tauri event listener
│   ├── components/
│   │   ├── NetworkMap.tsx   # MapLibre GL world map + arcs
│   │   ├── TopBar.tsx       # Floating status pills
│   │   └── StatsPanel.tsx   # Sidebar - sparklines, protocols, flows
│   └── telemetry/
│       ├── store.ts         # Zustand state
│       ├── schema.ts        # Frame type definitions
│       └── client.ts        # WebSocket fallback (browser dev)
└── sniffer-core/            # C++ packet sniffer (optional, unused)
```
