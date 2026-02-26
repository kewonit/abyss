#include "capture.hpp"

#include <pcap.h>
#include <iostream>
#include <cstring>
#include <algorithm>

#ifndef IPPROTO_TCP
#define IPPROTO_TCP 6
#endif
#ifndef IPPROTO_UDP
#define IPPROTO_UDP 17
#endif
#ifndef IPPROTO_ICMP
#define IPPROTO_ICMP 1
#endif

namespace abyss {

struct EthHeader {
  uint8_t  dst[6];
  uint8_t  src[6];
  uint16_t type;
};

struct IPv4Header {
  uint8_t  ver_ihl;
  uint8_t  tos;
  uint16_t total_len;
  uint16_t id;
  uint16_t frag_off;
  uint8_t  ttl;
  uint8_t  protocol;
  uint16_t checksum;
  uint32_t src_addr;
  uint32_t dst_addr;

  uint8_t ihl() const { return (ver_ihl & 0x0F) * 4; }
  uint8_t version() const { return (ver_ihl >> 4); }
};

struct TcpHeader {
  uint16_t src_port;
  uint16_t dst_port;
  uint32_t seq;
  uint32_t ack;
  uint8_t  data_offset;
  uint8_t  flags;
  uint16_t window;
  uint16_t checksum;
  uint16_t urgent;
};

struct UdpHeader {
  uint16_t src_port;
  uint16_t dst_port;
  uint16_t length;
  uint16_t checksum;
};

constexpr uint8_t TCP_RST = 0x04;
constexpr uint8_t TCP_SYN = 0x02;
constexpr uint8_t TCP_FIN = 0x01;

constexpr uint16_t ETH_TYPE_IP   = 0x0800;
constexpr uint16_t ETH_TYPE_ARP  = 0x0806;
constexpr uint16_t ETH_TYPE_IPV6 = 0x86DD;

static uint16_t ntohs_portable(uint16_t v) {
  const uint8_t* b = reinterpret_cast<const uint8_t*>(&v);
  return (static_cast<uint16_t>(b[0]) << 8) | b[1];
}

static uint32_t ntohl_portable(uint32_t v) {
  const uint8_t* b = reinterpret_cast<const uint8_t*>(&v);
  return (static_cast<uint32_t>(b[0]) << 24) |
         (static_cast<uint32_t>(b[1]) << 16) |
         (static_cast<uint32_t>(b[2]) << 8) |
         b[3];
}

CaptureEngine::CaptureEngine(const SnifferConfig& config, PacketRingBuffer& ring_buffer)
  : config_(config), ring_(ring_buffer) {

  if (config_.interface_name.empty()) {
    interface_ = auto_detect_interface();
  } else {
    interface_ = config_.interface_name;
  }
}

CaptureEngine::~CaptureEngine() {
  stop();
  if (handle_) {
    pcap_close(handle_);
    handle_ = nullptr;
  }
}

std::vector<NetworkInterface> CaptureEngine::list_interfaces() {
  std::vector<NetworkInterface> result;
  pcap_if_t* alldevs = nullptr;
  char errbuf[PCAP_ERRBUF_SIZE];

  if (pcap_findalldevs(&alldevs, errbuf) == -1) {
    std::cerr << "[Abyss] pcap_findalldevs failed: " << errbuf << std::endl;
    return result;
  }

  for (pcap_if_t* d = alldevs; d != nullptr; d = d->next) {
    NetworkInterface iface;
    iface.name = d->name;
    iface.description = d->description ? d->description : "";
    iface.is_loopback = (d->flags & PCAP_IF_LOOPBACK) != 0;
    iface.is_up = (d->flags & PCAP_IF_UP) != 0;

    iface.has_ipv4 = false;
    for (pcap_addr_t* a = d->addresses; a != nullptr; a = a->next) {
      if (a->addr && a->addr->sa_family == AF_INET) {
        iface.has_ipv4 = true;
        break;
      }
    }

    result.push_back(std::move(iface));
  }

  pcap_freealldevs(alldevs);
  return result;
}

std::string CaptureEngine::auto_detect_interface() {
  auto interfaces = list_interfaces();

  for (const auto& iface : interfaces) {
    if (!iface.is_loopback && iface.is_up && iface.has_ipv4) {
      std::cout << "[Abyss] Auto-detected interface: " << iface.name;
      if (!iface.description.empty()) {
        std::cout << " (" << iface.description << ")";
      }
      std::cout << std::endl;
      return iface.name;
    }
  }

  for (const auto& iface : interfaces) {
    if (!iface.is_loopback && iface.is_up) {
      std::cout << "[Abyss] Fallback interface: " << iface.name << std::endl;
      return iface.name;
    }
  }

  if (!interfaces.empty()) {
    std::cerr << "[Abyss] Warning: using first available interface: "
              << interfaces[0].name << std::endl;
    return interfaces[0].name;
  }

  std::cerr << "[Abyss] Error: no network interfaces found!" << std::endl;
  return "";
}

void CaptureEngine::start() {
  if (interface_.empty()) {
    std::cerr << "[Abyss] Cannot start capture: no interface configured" << std::endl;
    return;
  }

  char errbuf[PCAP_ERRBUF_SIZE];

  handle_ = pcap_open_live(
    interface_.c_str(),
    96,
    0,
    1,
    errbuf
  );

  if (!handle_) {
    std::cerr << "[Abyss] pcap_open_live failed: " << errbuf << std::endl;
    std::cerr << "[Abyss] Tip: run with elevated permissions (sudo / Administrator)" << std::endl;
    return;
  }

  int link_type = pcap_datalink(handle_);
  if (link_type != DLT_EN10MB && link_type != DLT_LINUX_SLL && link_type != DLT_NULL) {
    std::cerr << "[Abyss] Warning: unusual link type " << link_type
              << ", parsing may be incomplete" << std::endl;
  }

  running_.store(true, std::memory_order_release);
  std::cout << "[Abyss] Capture started on " << interface_ << std::endl;

  struct pcap_pkthdr* header;
  const uint8_t* data;

  while (running_.load(std::memory_order_acquire)) {
    int result = pcap_next_ex(handle_, &header, &data);

    if (result == 1) {
      PacketHeader ph = parse_packet(
        data, header->caplen, header->len, link_type
      );
      ring_.push(std::move(ph));
      packets_captured_.fetch_add(1, std::memory_order_relaxed);

    } else if (result == 0) {
      continue;

    } else if (result == -1) {
      std::cerr << "[Abyss] pcap_next_ex error: " << pcap_geterr(handle_) << std::endl;
      continue;

    } else if (result == -2) {
      break;
    }
  }

  running_.store(false, std::memory_order_release);
  std::cout << "[Abyss] Capture stopped" << std::endl;
}

void CaptureEngine::stop() {
  running_.store(false, std::memory_order_release);
  if (handle_) {
    pcap_breakloop(handle_);
  }
}

uint64_t CaptureEngine::packets_dropped() const {
  if (!handle_) return 0;
  struct pcap_stat stats;
  if (pcap_stats(handle_, &stats) == 0) {
    return stats.ps_drop;
  }
  return 0;
}

PacketHeader CaptureEngine::parse_packet(
  const uint8_t* data, uint32_t caplen, uint32_t wirelen, int link_type
) {
  PacketHeader ph{};
  ph.timestamp = PacketHeader::clock::now();
  ph.captured_len = caplen;
  ph.wire_len = wirelen;

  size_t eth_offset = 0;
  uint16_t eth_type = 0;

  if (link_type == DLT_EN10MB) {
    if (caplen < 14) return ph;
    const auto* eth = reinterpret_cast<const EthHeader*>(data);
    eth_type = ntohs_portable(eth->type);
    eth_offset = 14;
  }
#ifdef DLT_LINUX_SLL
  else if (link_type == DLT_LINUX_SLL) {
    if (caplen < 16) return ph;
    eth_type = ntohs_portable(*reinterpret_cast<const uint16_t*>(data + 14));
    eth_offset = 16;
  }
#endif
  else if (link_type == DLT_NULL) {
    if (caplen < 4) return ph;
    uint32_t family = *reinterpret_cast<const uint32_t*>(data);
    eth_type = (family == 2) ? ETH_TYPE_IP : ETH_TYPE_IPV6;
    eth_offset = 4;
  }
  else {
    return ph;
  }

  if (eth_type == ETH_TYPE_ARP) {
    ph.is_arp = true;
    return ph;
  }

  if (eth_type == ETH_TYPE_IP) {
    if (caplen < eth_offset + 20) return ph;
    const auto* ip = reinterpret_cast<const IPv4Header*>(data + eth_offset);

    if (ip->version() != 4) return ph;

    ph.ip_version = 4;
    ph.src_ip = ntohl_portable(ip->src_addr);
    ph.dst_ip = ntohl_portable(ip->dst_addr);
    ph.protocol = ip->protocol;

    size_t l4_offset = eth_offset + ip->ihl();

    if (ip->protocol == IPPROTO_ICMP) {
      ph.is_icmp = true;
      return ph;
    }

    if (ip->protocol == IPPROTO_TCP && caplen >= l4_offset + 20) {
      const auto* tcp = reinterpret_cast<const TcpHeader*>(data + l4_offset);
      ph.src_port = ntohs_portable(tcp->src_port);
      ph.dst_port = ntohs_portable(tcp->dst_port);
      ph.tcp_flags = tcp->flags;

      if (ph.src_port == 53 || ph.dst_port == 53) {
        ph.is_dns = true;
      }
    }

    if (ip->protocol == IPPROTO_UDP && caplen >= l4_offset + 8) {
      const auto* udp = reinterpret_cast<const UdpHeader*>(data + l4_offset);
      ph.src_port = ntohs_portable(udp->src_port);
      ph.dst_port = ntohs_portable(udp->dst_port);

      if (ph.src_port == 53 || ph.dst_port == 53 ||
          ph.src_port == 5353 || ph.dst_port == 5353) {
        ph.is_dns = true;
      }
    }
  }

  if (eth_type == ETH_TYPE_IPV6) {
    if (caplen < eth_offset + 40) return ph;
    ph.ip_version = 6;
    ph.protocol = data[eth_offset + 6];
    uint32_t src_hash = 0, dst_hash = 0;
    for (int i = 0; i < 16; i++) {
      src_hash = src_hash * 31 + data[eth_offset + 8 + i];
      dst_hash = dst_hash * 31 + data[eth_offset + 24 + i];
    }
    ph.src_ip = src_hash;
    ph.dst_ip = dst_hash;

    size_t l4_offset = eth_offset + 40;
    if (ph.protocol == IPPROTO_TCP && caplen >= l4_offset + 20) {
      const auto* tcp = reinterpret_cast<const TcpHeader*>(data + l4_offset);
      ph.src_port = ntohs_portable(tcp->src_port);
      ph.dst_port = ntohs_portable(tcp->dst_port);
      ph.tcp_flags = tcp->flags;
    }
    if (ph.protocol == IPPROTO_UDP && caplen >= l4_offset + 8) {
      const auto* udp = reinterpret_cast<const UdpHeader*>(data + l4_offset);
      ph.src_port = ntohs_portable(udp->src_port);
      ph.dst_port = ntohs_portable(udp->dst_port);
    }
    if (ph.protocol == 58) {
      ph.is_icmp = true;
    }
    if (ph.src_port == 53 || ph.dst_port == 53) {
      ph.is_dns = true;
    }
  }

  return ph;
}

}
