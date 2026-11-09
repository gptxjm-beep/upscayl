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
namespace jm {
inline std::filesystem::path control;
inline std::mutex events;
inline std::atomic<bool> failed{false};
inline std::atomic<bool> halted{false};
inline std::string unhex(const std::string& text) {
    if (text.empty() || text.size() % 2) return {};
    std::string result;
    auto nibble = [](char c) { if(c >= '0' && c <= '9') return c-'0'; if(c >= 'a' && c <= 'f') return c-'a'+10; return -1; };
    for(size_t i=0;i<text.size();i+=2) { int hi=nibble(text[i]),lo=nibble(text[i+1]); if(hi<0||lo<0) return {}; result += char(hi*16+lo); }
    if(result.find('\0') != std::string::npos) return {};
    return result;
}
inline void event(int id, bool ok) {
    if (!ok) failed = true;
    if(control.empty()) return;
    std::lock_guard<std::mutex> guard(events);
    printf("@JM1 %d %d\n", id, ok ? 1 : 0);
    fflush(stdout);
}
inline bool admit() {
    if(control.empty()) return true;
    if(halted) return false;
    std::error_code error;
    bool pause = std::filesystem::exists(control / "pause", error);
    if(error) { halted=true; return false; }
    auto lease = std::filesystem::last_write_time(control / "lease", error);
    if(error || pause || std::filesystem::file_time_type::clock::now() - lease > std::chrono::seconds(15)) halted = true;
    return !halted;
}
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
