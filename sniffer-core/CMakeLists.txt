cmake_minimum_required(VERSION 3.20)
project(abyss-sniffer VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ─── Options ───
option(ABYSS_USE_SYSTEM_PCAP "Use system-installed libpcap/Npcap" ON)
option(ABYSS_BUILD_TESTS "Build unit tests" OFF)

# ─── Dependencies via FetchContent ───
include(FetchContent)

# nlohmann/json — header-only JSON library
FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(json)

# IXWebSocket — cross-platform WebSocket (no Boost dependency)
FetchContent_Declare(
  ixwebsocket
  GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
  GIT_TAG        v11.4.5
  GIT_SHALLOW    TRUE
)
set(USE_TLS OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(ixwebsocket)

# ─── Find libpcap / Npcap ───
if(ABYSS_USE_SYSTEM_PCAP)
  if(WIN32)
    # Windows: look for Npcap SDK
    # Set NPCAP_SDK_DIR env variable or cmake variable to the Npcap SDK path
    if(DEFINED ENV{NPCAP_SDK_DIR})
      set(NPCAP_SDK_DIR $ENV{NPCAP_SDK_DIR})
    endif()

    if(NOT NPCAP_SDK_DIR)
      set(NPCAP_SDK_DIR "C:/npcap-sdk" CACHE PATH "Path to Npcap SDK")
    endif()

    if(EXISTS "${NPCAP_SDK_DIR}/Include")
      set(PCAP_INCLUDE_DIR "${NPCAP_SDK_DIR}/Include")
      if(CMAKE_SIZEOF_VOID_P EQUAL 8)
        set(PCAP_LIBRARY "${NPCAP_SDK_DIR}/Lib/x64/wpcap.lib")
        set(PACKET_LIBRARY "${NPCAP_SDK_DIR}/Lib/x64/Packet.lib")
      else()
        set(PCAP_LIBRARY "${NPCAP_SDK_DIR}/Lib/wpcap.lib")
        set(PACKET_LIBRARY "${NPCAP_SDK_DIR}/Lib/Packet.lib")
      endif()
      message(STATUS "Found Npcap SDK at: ${NPCAP_SDK_DIR}")
    else()
      message(WARNING
        "Npcap SDK not found at ${NPCAP_SDK_DIR}.\n"
        "Download from https://npcap.com/#download (SDK)\n"
        "Set NPCAP_SDK_DIR to the extracted path.")
    endif()
  else()
    # Linux/macOS: use pkg-config or find_library
    find_library(PCAP_LIBRARY NAMES pcap)
    find_path(PCAP_INCLUDE_DIR NAMES pcap.h pcap/pcap.h)

    if(NOT PCAP_LIBRARY)
      message(FATAL_ERROR
        "libpcap not found. Install via:\n"
        "  Ubuntu/Debian: sudo apt install libpcap-dev\n"
        "  macOS: brew install libpcap\n"
        "  Fedora: sudo dnf install libpcap-devel")
    endif()
    message(STATUS "Found libpcap: ${PCAP_LIBRARY}")
  endif()
endif()

# ─── Source files ───
set(SNIFFER_SOURCES
  src/main.cpp
  src/capture.cpp
  src/aggregator.cpp
  src/flow_table.cpp
  src/ws_broadcaster.cpp
)

set(SNIFFER_HEADERS
  src/capture.hpp
  src/aggregator.hpp
  src/flow_table.hpp
  src/ws_broadcaster.hpp
  src/ring_buffer.hpp
  src/metrics.hpp
  src/telemetry_schema.hpp
)

# ─── Executable ───
add_executable(abyss-sniffer ${SNIFFER_SOURCES} ${SNIFFER_HEADERS})

target_include_directories(abyss-sniffer PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${PCAP_INCLUDE_DIR}
)

target_link_libraries(abyss-sniffer PRIVATE
  nlohmann_json::nlohmann_json
  ixwebsocket::ixwebsocket
)

if(PCAP_LIBRARY)
  target_link_libraries(abyss-sniffer PRIVATE ${PCAP_LIBRARY})
endif()
if(WIN32 AND PACKET_LIBRARY)
  target_link_libraries(abyss-sniffer PRIVATE ${PACKET_LIBRARY} ws2_32)
endif()

# ─── Windows-specific ───
if(WIN32)
  target_compile_definitions(abyss-sniffer PRIVATE
    _WIN32_WINNT=0x0A00  # Windows 10
    NOMINMAX
    WIN32_LEAN_AND_MEAN
  )
endif()

# ─── Install target (for Tauri sidecar bundling) ───
install(TARGETS abyss-sniffer
  RUNTIME DESTINATION bin
)

message(STATUS "abyss-sniffer configured successfully")
