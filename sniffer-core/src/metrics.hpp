#pragma once

#include <cstdint>
#include <string>
#include <array>
#include <chrono>

namespace abyss {

struct PacketHeader {
  using clock = std::chrono::steady_clock;
  using time_point = clock::time_point;

  time_point timestamp;
  uint32_t   captured_len;
  uint32_t   wire_len;

  uint8_t    ip_version;
  uint32_t   src_ip;
  uint32_t   dst_ip;
  uint8_t    protocol;

  uint16_t   src_port;
  uint16_t   dst_port;
  uint8_t    tcp_flags;

  bool       is_arp;
  bool       is_dns;
  bool       is_icmp;
};

struct FlowKey {
  uint32_t src_ip;
  uint32_t dst_ip;
  uint16_t src_port;
  uint16_t dst_port;
  uint8_t  protocol;

  bool operator==(const FlowKey& other) const {
    return src_ip == other.src_ip && dst_ip == other.dst_ip &&
           src_port == other.src_port && dst_port == other.dst_port &&
           protocol == other.protocol;
  }
};

struct FlowKeyHash {
  size_t operator()(const FlowKey& k) const {
    size_t h = 0;
    h ^= std::hash<uint32_t>{}(k.src_ip) + 0x9e3779b9 + (h << 6) + (h >> 2);
    h ^= std::hash<uint32_t>{}(k.dst_ip) + 0x9e3779b9 + (h << 6) + (h >> 2);
    h ^= std::hash<uint16_t>{}(k.src_port) + 0x9e3779b9 + (h << 6) + (h >> 2);
    h ^= std::hash<uint16_t>{}(k.dst_port) + 0x9e3779b9 + (h << 6) + (h >> 2);
    h ^= std::hash<uint8_t>{}(k.protocol) + 0x9e3779b9 + (h << 6) + (h >> 2);
    return h;
  }
};

struct FlowState {
  FlowKey    key;
  uint64_t   bytes_total;
  uint64_t   packets_total;
  uint64_t   bytes_window;
  uint64_t   packets_window;
  double     rtt_estimate_ms;
  double     jitter_ms;
  bool       is_https;
  bool       is_heavy;
  uint8_t    direction;
  PacketHeader::time_point first_seen;
  PacketHeader::time_point last_seen;
};

struct ProtoCounters {
  uint32_t arp            = 0;
  uint32_t dns            = 0;
  uint32_t udp_small      = 0;
  uint32_t https_flows    = 0;
  uint32_t heavy_streams  = 0;
  uint32_t rst            = 0;
  uint32_t icmp_unreach   = 0;
  uint32_t firewall_blocks = 0;
};

struct NetMetrics {
  uint64_t bps           = 0;
  uint32_t pps           = 0;
  uint32_t active_flows  = 0;
  double   latency_ms    = 0.0;
  double   packet_loss   = 0.0;
  double   error_rate    = 0.0;
};

struct TopFlowSummary {
  std::string key;
  uint64_t    bps;
  double      rtt;
  double      jitter;
  uint8_t     dir;
};

struct SnifferHealth {
  uint64_t capture_drop = 0;
  float    queue_fill   = 0.0f;
  float    sniffer_fps  = 60.0f;
};

struct TelemetryFrame {
  uint32_t    schema_version = 1;
  double      timestamp;
  NetMetrics  net;
  ProtoCounters proto;
  std::array<TopFlowSummary, 8> top_flows;
  uint8_t     top_flow_count = 0;
  SnifferHealth health;
};

struct SnifferConfig {
  uint32_t small_packet_threshold = 128;
  double   heavy_throughput_mbps  = 12.0;
  double   heavy_sustain_seconds  = 2.5;
  double   ewma_alpha            = 0.2;
  double   window_duration_ms    = 16.666;
  double   flow_timeout_seconds  = 30.0;
  uint16_t ws_port               = 9770;
  std::string interface_name     = "";
};

}
