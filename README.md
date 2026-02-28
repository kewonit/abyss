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
|   writer.rs (SQLite)             store.ts (Zustand)          |
|   db.rs (queries)                sessions.ts (IPC)           |
|                                                              |
|   - netstat parser               - Interactive world map     |
|   - GeoIP resolver               - Great-circle arcs        |
|   - 1 Hz event loop              - Session browser           |
|   - Session persistence          - Playback / analytics      |
|   - Anomaly detection            - Health score dashboard    |
+--------------------------------------------------------------+
```

**Rust backend** runs `netstat` every second, parses active TCP/UDP connections, batch-geolocates public IPs via [ip-api.com](http://ip-api.com), and emits a `telemetry-frame` event through Tauri's IPC. A dedicated OS thread writer persists frames, flows, and process usage to SQLite (WAL mode). Baseline profiling and anomaly detection run against stored session data.

**React frontend** subscribes to that event, updates a Zustand store, and renders:

- **MapLibre GL** map with CARTO Dark Matter tiles
- **Great-circle arcs** from local machine to each remote endpoint
- **Floating status pills** showing throughput, latency, and flow count
- **Stats sidebar** with sparklines, protocol breakdown, and active flows
- **Session browser** with search, tagging, status badges, and comparison
- **Playback timeline** with speed control and keyboard shortcuts
- **Analytics dashboard** with cross-session trends and insights
- **Anomaly detection** with baseline profiling and health score

---

## Quick Start

### Prerequisites

- **Rust** (latest stable) — [rustup.rs](https://rustup.rs)
- **Node.js** ≥ 18 — [nodejs.org](https://nodejs.org)
- **Tauri CLI** — `cargo install tauri-cli`

### Development

```bash
# 1. Install frontend dependencies
cd visualizer && npm install && cd ..

# 2. Run the full app (Vite dev server + Rust backend)
cargo tauri dev
```

This starts the Vite dev server for the frontend and compiles + launches the Tauri desktop app. The app requires an **elevated/admin shell** on Windows for `netstat -bno` access.

### Production Build

```bash
cargo tauri build
```

Output goes to `tauri-host/src-tauri/target/release/bundle/`.

### Keyboard Shortcuts

| Key          | Action                |
| ------------ | --------------------- |
| `S`          | Toggle session drawer |
| `Escape`     | Return to live view   |
| `Ctrl+N`     | Start new session     |
| `Space`      | Play/pause playback   |
| `←` / `→`    | Skip ±10 frames       |
| `Home`/`End` | Jump to start/end     |

---

## Stack

| Layer    | Tech                                     |
| -------- | ---------------------------------------- |
| Shell    | Tauri v2                                 |
| Backend  | Rust (reqwest, tokio, serde, rusqlite)   |
| Database | SQLite (WAL mode, bundled via rusqlite)  |
| Frontend | React 18, Vite 6, Zustand 4, Tailwind v4 |
| Charts   | uPlot 1.6                                |
| Map      | MapLibre GL JS, CARTO Dark Matter tiles  |
| UI       | Radix UI (Dialog, Switch), Lucide icons  |
| GeoIP    | ip-api.com (free, no key)                |

---

## Structure

```
abyss/
├── tauri-host/src-tauri/
│   └── src/
│       ├── main.rs          # Entry point
│       ├── lib.rs           # 35+ Tauri commands, monitor loop, geo
│       ├── db.rs            # SQLite schema, migrations, analytics
│       └── writer.rs        # Dedicated OS thread for persistence
├── visualizer/src/
│   ├── App.tsx              # Root – event listener + keyboard shortcuts
│   ├── components/
│   │   ├── NetworkMap.tsx   # MapLibre GL world map + arcs
│   │   ├── TopBar.tsx       # Status pills, health score, settings
│   │   ├── StatsPanel.tsx   # Sidebar – sparklines, protocols, flows
│   │   ├── SessionDrawer.tsx    # Session browser with search & badges
│   │   ├── SessionDetail.tsx    # Full session analysis (3 tabs)
│   │   ├── PlaybackTimeline.tsx # Playback controls & speed
│   │   ├── AnalyticsDashboard.tsx # Cross-session analytics
│   │   ├── SessionComparison.tsx  # Side-by-side comparison
│   │   └── UPlotChart.tsx   # Chart wrapper
│   └── telemetry/
│       ├── store.ts         # Zustand state (live + playback)
│       ├── schema.ts        # Frame type definitions
│       ├── sessions.ts      # TypeScript interfaces + Tauri IPC
│       └── cables.ts        # Submarine cable overlay data
├── scripts/
│   ├── build-release.ps1    # Release build script
│   └── soak-test.ps1        # Performance soak testing
└── docs/internal/           # Implementation plans
```
