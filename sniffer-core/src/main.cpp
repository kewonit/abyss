#include "capture.hpp"
#include "aggregator.hpp"
#include "ws_broadcaster.hpp"
#include "ring_buffer.hpp"
#include "metrics.hpp"

#include <iostream>
#include <thread>
#include <csignal>
#include <atomic>
#include <string>
#include <cstring>

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

static std::atomic<bool> g_shutdown{false};

static void signal_handler(int signum) {
  (void)signum;
  std::cout << "\n[Abyss] Shutdown signal received..." << std::endl;
  g_shutdown.store(true, std::memory_order_release);
}

struct CliArgs {
  std::string interface_name;
  uint16_t port = 9770;
  bool list_interfaces = false;
  bool help = false;
};

static CliArgs parse_args(int argc, char* argv[]) {
  CliArgs args;
  for (int i = 1; i < argc; i++) {
    std::string arg = argv[i];

    if (arg == "-i" || arg == "--interface") {
      if (i + 1 < argc) {
        args.interface_name = argv[++i];
      } else {
        std::cerr << "Error: -i requires an interface name" << std::endl;
        args.help = true;
      }
    }
    else if (arg == "-p" || arg == "--port") {
      if (i + 1 < argc) {
        try {
          int port = std::stoi(argv[++i]);
          if (port < 1 || port > 65535) throw std::out_of_range("port");
          args.port = static_cast<uint16_t>(port);
        } catch (...) {
          std::cerr << "Error: invalid port number" << std::endl;
          args.help = true;
        }
      } else {
        std::cerr << "Error: -p requires a port number" << std::endl;
        args.help = true;
      }
    }
    else if (arg == "-l" || arg == "--list") {
      args.list_interfaces = true;
    }
    else if (arg == "-h" || arg == "--help") {
      args.help = true;
    }
    else {
      std::cerr << "Unknown argument: " << arg << std::endl;
      args.help = true;
    }
  }
  return args;
}

static void print_help() {
  std::cout << R"(
╔══════════════════════════════════════════════╗
║            ABYSS NETWORK SNIFFER             ║
║   Packet capture daemon for Abyss Visualizer ║
╚══════════════════════════════════════════════╝

Usage: abyss-sniffer [options]

Options:
  -i, --interface <name>   Network interface to capture from
                           (default: auto-detect best interface)
  -p, --port <num>         WebSocket server port (default: 9770)
  -l, --list               List available network interfaces
  -h, --help               Show this help

Examples:
  abyss-sniffer                     # Auto-detect interface, port 9770
  abyss-sniffer -i eth0             # Capture from eth0
  abyss-sniffer -i "Wi-Fi" -p 8080  # Custom interface and port

Notes:
  - Requires elevated permissions (sudo / Run as Administrator)
  - Telemetry is broadcast at ~60 Hz over WebSocket
  - Connect Abyss visualizer to ws://127.0.0.1:<port>
  - On Windows, install Npcap from https://npcap.com
)" << std::endl;
}

static void print_interfaces() {
  auto interfaces = abyss::CaptureEngine::list_interfaces();

  if (interfaces.empty()) {
    std::cerr << "No network interfaces found." << std::endl;
    std::cerr << "Ensure you have proper permissions and pcap is installed." << std::endl;
    return;
  }

  std::cout << "\nAvailable network interfaces:\n" << std::endl;
  std::cout << "  # | Name                     | Status    | IPv4 | Description" << std::endl;
  std::cout << "  ──┼──────────────────────────┼───────────┼──────┼───────────────────" << std::endl;

  int idx = 1;
  for (const auto& iface : interfaces) {
    std::cout << "  " << idx++ << " | ";

    std::string name = iface.name;
    if (name.length() > 24) name = name.substr(0, 21) + "...";
    std::cout << name;
    for (size_t i = name.length(); i < 24; i++) std::cout << ' ';

    std::cout << " | ";

    if (iface.is_loopback) {
      std::cout << "loopback ";
    } else if (iface.is_up) {
      std::cout << "UP       ";
    } else {
      std::cout << "down     ";
    }

    std::cout << " | ";
    std::cout << (iface.has_ipv4 ? "yes " : "no  ");
    std::cout << " | ";
    std::cout << iface.description;
    std::cout << std::endl;
  }

  std::cout << "\nUse -i <name> to select an interface." << std::endl;
}

int main(int argc, char* argv[]) {
  auto args = parse_args(argc, argv);

  if (args.help) {
    print_help();
    return 0;
  }

  if (args.list_interfaces) {
    print_interfaces();
    return 0;
  }

  std::cout << R"(
    ┌─────────────────────────────────┐
    │     🌊 ABYSS NETWORK SNIFFER    │
    │         v0.1.0                  │
    └─────────────────────────────────┘
  )" << std::endl;

  std::signal(SIGINT, signal_handler);
  std::signal(SIGTERM, signal_handler);
#ifdef _WIN32
  SetConsoleCtrlHandler([](DWORD type) -> BOOL {
    if (type == CTRL_C_EVENT || type == CTRL_CLOSE_EVENT) {
      g_shutdown.store(true, std::memory_order_release);
      return TRUE;
    }
    return FALSE;
  }, TRUE);
#endif

  abyss::SnifferConfig config;
  config.interface_name = args.interface_name;
  config.ws_port = args.port;

  abyss::CaptureEngine::PacketRingBuffer ring_buffer;

  abyss::CaptureEngine capture(config, ring_buffer);
  abyss::Aggregator aggregator(config, ring_buffer);
  abyss::WSBroadcaster broadcaster(config.ws_port);

  std::cout << "[Abyss] Interface: " << capture.interface_name() << std::endl;
  std::cout << "[Abyss] WebSocket port: " << config.ws_port << std::endl;

  if (!broadcaster.start()) {
    std::cerr << "[Abyss] Failed to start WebSocket server. Exiting." << std::endl;
    return 1;
  }

  aggregator.on_frame([&broadcaster](const abyss::TelemetryFrame& frame) {
    broadcaster.broadcast(frame);
  });

  std::thread capture_thread([&capture]() {
    capture.start();
  });

  std::thread aggregator_thread([&aggregator]() {
    aggregator.start();
  });

  std::cout << "[Abyss] All systems online. Ctrl+C to stop." << std::endl;

  while (!g_shutdown.load(std::memory_order_acquire)) {
    std::this_thread::sleep_for(std::chrono::seconds(1));

    aggregator.update_health(
      capture.packets_dropped(),
      ring_buffer.fill_ratio()
    );

    static int tick = 0;
    if (++tick % 10 == 0) {
      std::cout << "[Abyss] Status: "
                << capture.packets_captured() << " pkts captured, "
                << ring_buffer.drops() << " ring drops, "
                << broadcaster.client_count() << " clients, "
                << broadcaster.frames_sent() << " frames sent"
                << std::endl;
    }
  }

  std::cout << "[Abyss] Shutting down..." << std::endl;

  capture.stop();
  aggregator.stop();

  if (capture_thread.joinable()) {
    capture_thread.join();
  }
  if (aggregator_thread.joinable()) {
    aggregator_thread.join();
  }

  broadcaster.stop();

  std::cout << "[Abyss] Final stats: "
            << capture.packets_captured() << " packets captured, "
            << broadcaster.frames_sent() << " telemetry frames sent"
            << std::endl;
  std::cout << "[Abyss] Goodbye." << std::endl;

  return 0;
}
