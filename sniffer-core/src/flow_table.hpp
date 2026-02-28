#pragma once

#include "metrics.hpp"
#include <unordered_map>
#include <vector>
#include <mutex>
#include <algorithm>
#include <cstdio>

namespace abyss {

class FlowTable {
public:
  explicit FlowTable(const SnifferConfig& config) : config_(config) {
    flows_.reserve(1024);
  }

  void update(const PacketHeader& pkt) {
    if (pkt.protocol == 0 && !pkt.is_arp && !pkt.is_dns && !pkt.is_icmp) {
      return;
    }

    FlowKey key{pkt.src_ip, pkt.dst_ip, pkt.src_port, pkt.dst_port, pkt.protocol};

    FlowKey rev_key{pkt.dst_ip, pkt.src_ip, pkt.dst_port, pkt.src_port, pkt.protocol};

    auto it = flows_.find(key);
    auto rev_it = flows_.find(rev_key);

    if (rev_it != flows_.end()) {
      auto& flow = rev_it->second;
      flow.bytes_total += pkt.wire_len;
      flow.bytes_window += pkt.wire_len;
      flow.packets_total++;
      flow.packets_window++;
      flow.last_seen = pkt.timestamp;
      flow.direction = 2;
      return;
    }

    if (it != flows_.end()) {
      auto& flow = it->second;
      flow.bytes_total += pkt.wire_len;
      flow.bytes_window += pkt.wire_len;
      flow.packets_total++;
      flow.packets_window++;
      flow.last_seen = pkt.timestamp;
    } else {
      FlowState flow{};
      flow.key = key;
      flow.bytes_total = pkt.wire_len;
      flow.bytes_window = pkt.wire_len;
      flow.packets_total = 1;
      flow.packets_window = 1;
      flow.first_seen = pkt.timestamp;
      flow.last_seen = pkt.timestamp;
      flow.direction = 0;

      flow.is_https = (pkt.src_port == 443 || pkt.dst_port == 443);

      if (pkt.src_port < pkt.dst_port) {
        flow.direction = 1;
      }

      flows_.emplace(key, std::move(flow));
    }
  }

  void expire(PacketHeader::time_point now) {
    auto timeout = std::chrono::duration<double>(config_.flow_timeout_seconds);
    auto it = flows_.begin();
    while (it != flows_.end()) {
      auto age = std::chrono::duration<double>(now - it->second.last_seen);
      if (age > timeout) {
        it = flows_.erase(it);
      } else {
        ++it;
      }
    }
  }

  size_t active_count() const { return flows_.size(); }

  uint32_t count_https() const {
    uint32_t count = 0;
    for (const auto& [_, flow] : flows_) {
      if (flow.is_https) count++;
    }
    return count;
  }

  uint32_t count_heavy_streams(double window_seconds) const {
    if (window_seconds <= 0) return 0;
    uint32_t count = 0;
    double threshold_bytes = config_.heavy_throughput_mbps * 1e6 / 8.0 * window_seconds;
    for (const auto& [_, flow] : flows_) {
      if (static_cast<double>(flow.bytes_window) > threshold_bytes) {
        count++;
      }
    }
    return count;
  }

  std::vector<TopFlowSummary> top_flows(size_t n, double window_seconds) const {
    if (window_seconds <= 0) return {};

    std::vector<std::pair<uint64_t, const FlowState*>> candidates;
    candidates.reserve(flows_.size());

    for (const auto& [_, flow] : flows_) {
      if (flow.bytes_window > 0) {
        candidates.emplace_back(flow.bytes_window, &flow);
      }
    }

    size_t count = std::min(n, candidates.size());
    std::partial_sort(
      candidates.begin(),
      candidates.begin() + count,
      candidates.end(),
      [](const auto& a, const auto& b) { return a.first > b.first; }
    );

    std::vector<TopFlowSummary> result;
    result.reserve(count);

    for (size_t i = 0; i < count; i++) {
      const auto* flow = candidates[i].second;
      TopFlowSummary summary;

      // Use snprintf instead of string concatenation — avoids ~15 temporary std::string allocations
      char keybuf[64];
      uint32_t s = flow->key.src_ip;
      uint32_t d = flow->key.dst_ip;
      int len = snprintf(keybuf, sizeof(keybuf),
        "%u.%u.%u.%u:%u.%u.%u.%u:%u",
        (s >> 24) & 0xFF, (s >> 16) & 0xFF, (s >> 8) & 0xFF, s & 0xFF,
        (d >> 24) & 0xFF, (d >> 16) & 0xFF, (d >> 8) & 0xFF, d & 0xFF,
        static_cast<unsigned>(flow->key.dst_port));
      summary.key.assign(keybuf, len > 0 ? static_cast<size_t>(len) : 0);

      summary.bps = static_cast<uint64_t>(
        static_cast<double>(flow->bytes_window) * 8.0 / window_seconds
      );
      summary.rtt = flow->rtt_estimate_ms;
      summary.jitter = flow->jitter_ms;
      summary.dir = flow->direction;

      result.push_back(std::move(summary));
    }

    return result;
  }

  uint64_t total_bps(double window_seconds) const {
    if (window_seconds <= 0) return 0;
    uint64_t total_bytes = 0;
    for (const auto& [_, flow] : flows_) {
      total_bytes += flow.bytes_window;
    }
    return static_cast<uint64_t>(
      static_cast<double>(total_bytes) * 8.0 / window_seconds
    );
  }

  uint32_t total_pps(double window_seconds) const {
    if (window_seconds <= 0) return 0;
    uint64_t total_pkts = 0;
    for (const auto& [_, flow] : flows_) {
      total_pkts += flow.packets_window;
    }
    return static_cast<uint32_t>(
      static_cast<double>(total_pkts) / window_seconds
    );
  }

  void reset_window_counters() {
    for (auto& [_, flow] : flows_) {
      flow.bytes_window = 0;
      flow.packets_window = 0;
    }
  }

  const std::unordered_map<FlowKey, FlowState, FlowKeyHash>& flows() const {
    return flows_;
  }

private:
  SnifferConfig config_;
  std::unordered_map<FlowKey, FlowState, FlowKeyHash> flows_;
};

}
