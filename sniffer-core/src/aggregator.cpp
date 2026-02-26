#include "aggregator.hpp"
#include <thread>
#include <iostream>
#include <cmath>
#include <algorithm>

namespace abyss {

Aggregator::Aggregator(const SnifferConfig& config, PacketRingBuffer& ring_buffer)
  : config_(config), ring_(ring_buffer), flow_table_(config) {}

void Aggregator::start() {
  running_.store(true, std::memory_order_release);
  start_time_ = clock::now();

  const auto window_duration = std::chrono::duration<double, std::milli>(
    config_.window_duration_ms
  );

  auto window_start = clock::now();
  auto last_expire = clock::now();

  uint64_t frames_produced = 0;
  auto fps_timer = clock::now();

  std::cout << "[Abyss] Aggregator started (window: "
            << config_.window_duration_ms << "ms)" << std::endl;

  while (running_.load(std::memory_order_acquire)) {
    auto now = clock::now();

    drain_ring();

    auto elapsed = std::chrono::duration<double, std::milli>(now - window_start);

    if (elapsed >= window_duration) {
      double window_seconds = elapsed.count() / 1000.0;

      TelemetryFrame frame = build_frame(window_seconds);
      frames_produced++;

      if (frame_callback_) {
        frame_callback_(frame);
      }

      flow_table_.reset_window_counters();
      window_arp_ = 0;
      window_dns_ = 0;
      window_udp_small_ = 0;
      window_rst_ = 0;
      window_icmp_unreach_ = 0;
      window_total_pkts_ = 0;
      window_total_bytes_ = 0;

      window_start = now;
    }

    auto expire_elapsed = std::chrono::duration<double>(now - last_expire);
    if (expire_elapsed.count() > 5.0) {
      flow_table_.expire(now);
      last_expire = now;
    }

    auto fps_elapsed = std::chrono::duration<double>(now - fps_timer);
    if (fps_elapsed.count() >= 1.0) {
      health_queue_fill_ = ring_.fill_ratio();
      fps_timer = now;
    }

    auto sleep_time = std::chrono::duration<double, std::milli>(
      config_.window_duration_ms / 4.0
    );

    double sleep_ms = std::max(1.0, std::min(8.0, sleep_time.count()));
    std::this_thread::sleep_for(
      std::chrono::microseconds(static_cast<int64_t>(sleep_ms * 1000))
    );
  }

  std::cout << "[Abyss] Aggregator stopped (" << frames_produced
            << " frames produced)" << std::endl;
}

void Aggregator::stop() {
  running_.store(false, std::memory_order_release);
}

void Aggregator::update_health(uint64_t capture_drops, float queue_fill) {
  health_capture_drops_ = capture_drops;
  health_queue_fill_ = queue_fill;
}

void Aggregator::drain_ring() {
  constexpr int MAX_DRAIN = 4096;
  int drained = 0;

  while (drained < MAX_DRAIN) {
    auto pkt = ring_.pop();
    if (!pkt) break;

    const auto& p = *pkt;

    flow_table_.update(p);

    window_total_pkts_++;
    window_total_bytes_ += p.wire_len;

    if (p.is_arp) window_arp_++;
    if (p.is_dns) window_dns_++;
    if (p.is_icmp) window_icmp_unreach_++;

    if (p.protocol == 17 && p.wire_len <= config_.small_packet_threshold) {
      window_udp_small_++;
    }

    if (p.tcp_flags & 0x04) {
      window_rst_++;
    }

    drained++;
  }
}

TelemetryFrame Aggregator::build_frame(double window_seconds) {
  TelemetryFrame frame;
  frame.schema_version = 1;

  auto now = clock::now();
  frame.timestamp = std::chrono::duration<double>(now - start_time_).count();

  frame.net.bps = flow_table_.total_bps(window_seconds);
  frame.net.pps = flow_table_.total_pps(window_seconds);
  frame.net.active_flows = static_cast<uint32_t>(flow_table_.active_count());

  if (window_total_pkts_ > 1 && window_seconds > 0) {
    double avg_inter_packet_ms = (window_seconds * 1000.0) / window_total_pkts_;
    avg_inter_packet_ms = std::min(avg_inter_packet_ms, 500.0);

    ewma_latency_ms_ = config_.ewma_alpha * avg_inter_packet_ms +
                       (1.0 - config_.ewma_alpha) * ewma_latency_ms_;
  }
  frame.net.latency_ms = ewma_latency_ms_;

  if (window_total_pkts_ > 0) {
    frame.net.packet_loss = static_cast<double>(window_rst_) /
                            static_cast<double>(window_total_pkts_);
    frame.net.packet_loss = std::min(frame.net.packet_loss, 1.0);
  }

  if (window_total_pkts_ > 0) {
    frame.net.error_rate = static_cast<double>(window_rst_ + window_icmp_unreach_) /
                           static_cast<double>(window_total_pkts_);
    frame.net.error_rate = std::min(frame.net.error_rate, 1.0);
  }

  frame.proto.arp = window_arp_;
  frame.proto.dns = window_dns_;
  frame.proto.udp_small = window_udp_small_;
  frame.proto.https_flows = flow_table_.count_https();
  frame.proto.heavy_streams = flow_table_.count_heavy_streams(window_seconds);
  frame.proto.rst = window_rst_;
  frame.proto.icmp_unreach = window_icmp_unreach_;
  frame.proto.firewall_blocks = 0;

  auto top = flow_table_.top_flows(8, window_seconds);
  frame.top_flow_count = static_cast<uint8_t>(top.size());
  for (size_t i = 0; i < top.size() && i < 8; i++) {
    frame.top_flows[i] = std::move(top[i]);
  }

  frame.health.capture_drop = health_capture_drops_;
  frame.health.queue_fill = health_queue_fill_;
  if (window_seconds > 0) {
    frame.health.sniffer_fps = static_cast<float>(1.0 / window_seconds);
  }

  auto sanitize = [](double& v) {
    if (std::isnan(v) || std::isinf(v)) v = 0.0;
  };
  sanitize(frame.net.latency_ms);
  sanitize(frame.net.packet_loss);
  sanitize(frame.net.error_rate);
  sanitize(frame.timestamp);

  return frame;
}

}
