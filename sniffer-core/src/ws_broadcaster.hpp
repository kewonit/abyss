#pragma once

#include "metrics.hpp"
#include "telemetry_schema.hpp"
#include <ixwebsocket/IXWebSocketServer.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <atomic>
#include <mutex>
#include <vector>
#include <string>
#include <functional>
#include <iostream>

namespace abyss {

class WSBroadcaster {
public:
  explicit WSBroadcaster(uint16_t port)
    : port_(port), server_(static_cast<int>(port), "127.0.0.1") {}

  ~WSBroadcaster() { stop(); }

  WSBroadcaster(const WSBroadcaster&) = delete;
  WSBroadcaster& operator=(const WSBroadcaster&) = delete;

  bool start() {
    server_.setOnClientMessageCallback(
      [this](std::shared_ptr<ix::ConnectionState> state,
             ix::WebSocket& ws,
             const ix::WebSocketMessagePtr& msg) {
        handle_message(state, ws, msg);
      }
    );

    auto res = server_.listen();
    if (!res.first) {
      std::cerr << "[Abyss] WebSocket server failed to listen on port "
                << port_ << ": " << res.second << std::endl;
      return false;
    }

    server_.start();
    running_.store(true, std::memory_order_release);
    std::cout << "[Abyss] WebSocket server listening on ws://127.0.0.1:"
              << port_ << std::endl;
    return true;
  }

  void stop() {
    if (running_.load(std::memory_order_acquire)) {
      server_.stop();
      {
        std::lock_guard<std::mutex> lock(clients_mutex_);
        clients_.clear();
      }
      running_.store(false, std::memory_order_release);
      std::cout << "[Abyss] WebSocket server stopped" << std::endl;
    }
  }

  void broadcast(const TelemetryFrame& frame) {
    if (!running_.load(std::memory_order_acquire)) return;

    nlohmann::json j = telemetry_to_json(frame);
    std::string payload = j.dump();

    std::lock_guard<std::mutex> lock(clients_mutex_);
    for (auto* client : clients_) {
      if (client) {
        client->send(payload, false);
      }
    }

    frames_sent_.fetch_add(1, std::memory_order_relaxed);
  }

  size_t client_count() const {
    std::lock_guard<std::mutex> lock(clients_mutex_);
    return clients_.size();
  }

  uint64_t frames_sent() const {
    return frames_sent_.load(std::memory_order_relaxed);
  }

  bool is_running() const {
    return running_.load(std::memory_order_acquire);
  }

private:
  void handle_message(
    std::shared_ptr<ix::ConnectionState> state,
    ix::WebSocket& ws,
    const ix::WebSocketMessagePtr& msg
  ) {
    switch (msg->type) {
      case ix::WebSocketMessageType::Open: {
        std::cout << "[Abyss] Client connected: " << state->getRemoteIp()
                  << " (id: " << state->getId() << ")" << std::endl;
        {
          std::lock_guard<std::mutex> lock(clients_mutex_);
          clients_.push_back(&ws);
        }
        nlohmann::json hello;
        hello["type"] = "hello";
        hello["schema"] = 2;
        hello["server"] = "abyss-sniffer";
        hello["version"] = "0.1.0";
        ws.send(hello.dump());
        break;
      }

      case ix::WebSocketMessageType::Close: {
        std::cout << "[Abyss] Client disconnected: " << state->getId() << std::endl;
        remove_client(ws);
        break;
      }

      case ix::WebSocketMessageType::Error: {
        std::cerr << "[Abyss] Client error: " << msg->errorInfo.reason << std::endl;
        remove_client(ws);
        break;
      }

      case ix::WebSocketMessageType::Message: {
        try {
          auto cmd = nlohmann::json::parse(msg->str);
          if (cmd.contains("type") && cmd["type"] == "ping") {
            nlohmann::json pong;
            pong["type"] = "pong";
            pong["t"] = cmd.value("t", 0.0);
            ws.send(pong.dump());
          }
        } catch (...) {}
        break;
      }

      default:
        break;
    }
  }

  void remove_client(ix::WebSocket& ws) {
    std::lock_guard<std::mutex> lock(clients_mutex_);
    clients_.erase(
      std::remove(clients_.begin(), clients_.end(), &ws),
      clients_.end()
    );
  }

  uint16_t port_;
  ix::WebSocketServer server_;
  std::atomic<bool> running_{false};
  std::atomic<uint64_t> frames_sent_{0};
  mutable std::mutex clients_mutex_;
  std::vector<ix::WebSocket*> clients_;
};

}
