#pragma once

#include "metrics.hpp"
#include <nlohmann/json.hpp>

namespace abyss {

inline nlohmann::json telemetry_to_json(const TelemetryFrame& frame) {
  nlohmann::json j;

  j["schema"] = frame.schema_version;
  j["t"] = frame.timestamp;

  j["net"] = {
    {"bps", frame.net.bps},
    {"pps", frame.net.pps},
    {"active_flows", frame.net.active_flows},
    {"latency_ms", frame.net.latency_ms},
    {"packet_loss", frame.net.packet_loss},
    {"error_rate", frame.net.error_rate}
  };

  j["proto"] = {
    {"arp", frame.proto.arp},
    {"dns", frame.proto.dns},
    {"udp_small", frame.proto.udp_small},
    {"https_flows", frame.proto.https_flows},
    {"heavy_streams", frame.proto.heavy_streams},
    {"rst", frame.proto.rst},
    {"icmp_unreach", frame.proto.icmp_unreach},
    {"firewall_blocks", frame.proto.firewall_blocks}
  };

  nlohmann::json flows = nlohmann::json::array();
  for (uint8_t i = 0; i < frame.top_flow_count && i < 8; i++) {
    const auto& flow = frame.top_flows[i];
    const char* dir_str = flow.dir == 0 ? "down" : (flow.dir == 1 ? "up" : "bidi");
    flows.push_back({
      {"key", flow.key},
      {"bps", flow.bps},
      {"rtt", flow.rtt},
      {"jitter", flow.jitter},
      {"dir", dir_str}
    });
  }
  j["top_flows"] = flows;

  j["health"] = {
    {"capture_drop", frame.health.capture_drop},
    {"queue_fill", frame.health.queue_fill},
    {"sniffer_fps", frame.health.sniffer_fps}
  };

  return j;
}

}
