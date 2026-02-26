#pragma once

#include "metrics.hpp"
#include "ring_buffer.hpp"
#include "flow_table.hpp"
#include <atomic>
#include <functional>
#include <chrono>

namespace abyss {

class Aggregator {
public:
  using PacketRingBuffer = RingBuffer<PacketHeader, 8192>;
  using FrameCallback = std::function<void(const TelemetryFrame&)>;

  Aggregator(const SnifferConfig& config, PacketRingBuffer& ring_buffer);

  Aggregator(const Aggregator&) = delete;
  Aggregator& operator=(const Aggregator&) = delete;

  void on_frame(FrameCallback cb) { frame_callback_ = std::move(cb); }
  void start();
  void stop();
  bool is_running() const { return running_.load(std::memory_order_acquire); }
  void update_health(uint64_t capture_drops, float queue_fill);

private:
  void drain_ring();
  TelemetryFrame build_frame(double window_seconds);

  SnifferConfig       config_;
  PacketRingBuffer&   ring_;
  FlowTable           flow_table_;
  FrameCallback       frame_callback_;
  std::atomic<bool>   running_{false};

  uint32_t window_arp_         = 0;
  uint32_t window_dns_         = 0;
  uint32_t window_udp_small_   = 0;
  uint32_t window_rst_         = 0;
  uint32_t window_icmp_unreach_ = 0;
  uint32_t window_total_pkts_  = 0;
  uint64_t window_total_bytes_ = 0;

  uint64_t health_capture_drops_ = 0;
  float    health_queue_fill_    = 0.0f;

  using clock = std::chrono::steady_clock;
  clock::time_point start_time_;

  double ewma_latency_ms_ = 0.0;
};

}
