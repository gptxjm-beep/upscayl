// Enhanced session protocol v1. No dependencies on Vulkan or NCNN.
#pragma once
#include <atomic>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <vector>
#include <cstdio>
#include <chrono>
#include <set>
#include <thread>
namespace jm {
inline std::filesystem::path control;
inline std::mutex events;
inline std::atomic<bool> failed{false};
inline std::atomic<bool> halted{false};
inline std::mutex inference_gate;
inline std::set<int> active;
inline unsigned long long tick() {
    return std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
inline void trace(const char* kind, int id) {
    if(control.empty()) return;
    std::lock_guard<std::mutex> guard(events);
    printf("@JM3 %s %d %llu\n", kind, id, tick()); fflush(stdout);
}
inline std::string unhex(const std::string& text) {
    if (text.empty() || text.size() % 2) return {};
    std::string result;
    auto nibble = [](char c) { if(c >= '0' && c <= '9') return c-'0'; if(c >= 'a' && c <= 'f') return c-'a'+10; return -1; };
    for(size_t i=0;i<text.size();i+=2) { int hi=nibble(text[i]),lo=nibble(text[i+1]); if(hi<0||lo<0) return {}; result += char(hi*16+lo); }
    if(result.find('\0') != std::string::npos) return {};
    return result;
}
inline void event(int id, bool ok, const char* stage = "encode", int code = 0) {
    if (!ok) failed = true;
    if(control.empty()) return;
    std::lock_guard<std::mutex> guard(events);
    printf("@JM2 %d %d %s %d\n", id, ok ? 1 : 0, stage, code);
    fflush(stdout);
}
// Caller holds inference_gate. This is the same lock that registers starts.
inline void check_gate_locked() {
    if(halted) return;
    std::error_code error;
    bool pause = std::filesystem::exists(control / "pause", error);
    bool stop=bool(error) || pause;
    if(!stop) {
        auto lease = std::filesystem::last_write_time(control / "lease", error);
        stop=bool(error) || std::filesystem::file_time_type::clock::now() - lease > std::chrono::seconds(15);
    }
    if(!stop) return;
    halted=true;
    std::lock_guard<std::mutex> guard(events);
    printf("@JM3 GATE %llu", tick());
    for(int id:active) printf(" %d",id);
    printf("\n");fflush(stdout);
}
inline bool admit() {
    if(control.empty()) return true;
    std::lock_guard<std::mutex> guard(inference_gate);
    check_gate_locked();return !halted;
}
inline bool begin_inference(int id) {
    if(control.empty()) return true;
    std::lock_guard<std::mutex> guard(inference_gate);
    check_gate_locked();
    if(halted) {trace("DEFER",id);return false;}
    // Linearization point: this invocation owns permission to enter process().
    active.insert(id);trace("START",id);return true;
}
inline void end_inference(int id) {
    if(control.empty()) return;
    std::lock_guard<std::mutex> guard(inference_gate);
    active.erase(id);trace("END",id);
}
struct Monitor {
    std::atomic<bool> done{false};std::thread worker;
    Monitor() {
        if(!control.empty()) worker=std::thread([this]{
            while(!done) {admit();std::this_thread::sleep_for(std::chrono::milliseconds(20));}
        });
    }
    ~Monitor(){done=true;if(worker.joinable())worker.join();}
};
struct Paths { std::filesystem::path input, output; };
inline std::vector<Paths> manifest(const std::filesystem::path& path) {
    std::ifstream stream(path);
    if(!stream) return {};
    std::vector<Paths> result;
    std::string line;
    while(std::getline(stream,line)) {
        if(!line.empty() && line.back()=='\r') line.pop_back();
        auto tab=line.find('\t');
        if(tab==std::string::npos) return {};
        auto input=std::filesystem::u8path(unhex(line.substr(0,tab)));
        auto output=std::filesystem::u8path(unhex(line.substr(tab+1)));
        if(!input.is_absolute() || !output.is_absolute() || input==output) return {};
        result.push_back({input,output});
    }

    return result;
}
}
