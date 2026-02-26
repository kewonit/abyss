#pragma once

#include "metrics.hpp"
#include "ring_buffer.hpp"
#include <functional>
#include <string>
#include <vector>
#include <atomic>
#include <memory>

struct pcap;
typedef struct pcap pcap_t;

namespace abyss {

struct NetworkInterface {
  std::string name;
  std::string description;
  bool        is_loopback;
  bool        is_up;
  bool        has_ipv4;
};

class CaptureEngine {
public:
  using PacketRingBuffer = RingBuffer<PacketHeader, 8192>;

  CaptureEngine(const SnifferConfig& config, PacketRingBuffer& ring_buffer);
  ~CaptureEngine();

  CaptureEngine(const CaptureEngine&) = delete;
  CaptureEngine& operator=(const CaptureEngine&) = delete;

  static std::vector<NetworkInterface> list_interfaces();
  static std::string auto_detect_interface();
  void start();
  void stop();
  bool is_running() const { return running_.load(std::memory_order_acquire); }
  uint64_t packets_captured() const { return packets_captured_.load(); }
  uint64_t packets_dropped() const;
  const std::string& interface_name() const { return interface_; }

private:
  static PacketHeader parse_packet(const uint8_t* data, uint32_t caplen,
                                   uint32_t wirelen, int link_type);

  SnifferConfig       config_;
  PacketRingBuffer&   ring_;
  std::string         interface_;
  pcap_t*             handle_ = nullptr;
  std::atomic<bool>   running_{false};
  std::atomic<uint64_t> packets_captured_{0};
};

}
