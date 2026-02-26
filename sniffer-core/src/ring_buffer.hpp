#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <optional>

namespace abyss {

template <typename T, size_t Capacity>
class RingBuffer {
  static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be a power of 2");

public:
  RingBuffer() : head_(0), tail_(0) {}

  void push(const T& item) {
    const size_t head = head_.load(std::memory_order_relaxed);
    const size_t next_head = (head + 1) & MASK;

    size_t tail = tail_.load(std::memory_order_acquire);
    if (next_head == tail) {
      tail_.store((tail + 1) & MASK, std::memory_order_release);
      drops_++;
    }

    buffer_[head] = item;
    head_.store(next_head, std::memory_order_release);
  }

  void push(T&& item) {
    const size_t head = head_.load(std::memory_order_relaxed);
    const size_t next_head = (head + 1) & MASK;

    size_t tail = tail_.load(std::memory_order_acquire);
    if (next_head == tail) {
      tail_.store((tail + 1) & MASK, std::memory_order_release);
      drops_++;
    }

    buffer_[head] = std::move(item);
    head_.store(next_head, std::memory_order_release);
  }

  std::optional<T> pop() {
    const size_t tail = tail_.load(std::memory_order_relaxed);
    const size_t head = head_.load(std::memory_order_acquire);

    if (tail == head) {
      return std::nullopt;
    }

    T item = std::move(buffer_[tail]);
    tail_.store((tail + 1) & MASK, std::memory_order_release);
    return item;
  }

  bool empty() const {
    return head_.load(std::memory_order_acquire) ==
           tail_.load(std::memory_order_acquire);
  }

  float fill_ratio() const {
    const size_t head = head_.load(std::memory_order_acquire);
    const size_t tail = tail_.load(std::memory_order_acquire);
    const size_t used = (head - tail) & MASK;
    return static_cast<float>(used) / static_cast<float>(Capacity);
  }

  uint64_t drops() const { return drops_; }

  void reset_drops() { drops_ = 0; }

  static constexpr size_t capacity() { return Capacity; }

private:
  static constexpr size_t MASK = Capacity - 1;

  std::array<T, Capacity> buffer_;
  alignas(64) std::atomic<size_t> head_;
  alignas(64) std::atomic<size_t> tail_;
  std::atomic<uint64_t> drops_{0};
};

}
