// Native Windows codec regression: no Vulkan/GPU, real WIC on fresh threads.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include <filesystem>
#include <fstream>
#include <cassert>
#include "../../vendor/upscayl-ncnn/src/wic_image.h"

int wmain(int argc, wchar_t** argv) {
 if(argc != 2) return 2;
 const auto root=std::filesystem::path(argv[1]);
 std::filesystem::create_directories(root);
 bool uninitialized=false, passed=false;
 std::thread legacy([&]{
    IWICImagingFactory* factory=nullptr;
    HRESULT hr=CoCreateInstance(CLSID_WICImagingFactory1,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory));
    uninitialized=hr==CO_E_NOTINITIALIZED;
    if(factory) factory->Release();
    printf("Fresh worker without COM: HRESULT=0x%08lx\n",static_cast<unsigned long>(hr));
 });legacy.join();
 if(!uninitialized) return 3;
 // Match the old engine as well: main() keeps an MTA alive. Windows may
 // implicitly admit a fresh worker to that MTA; do not claim the previous
 // no-COM control alone reproduces jm.1's image failure.
 const HRESULT mainApartment=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
 std::thread implicitMta([]{
    IWICImagingFactory* factory=nullptr;
    HRESULT hr=CoCreateInstance(CLSID_WICImagingFactory1,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory));
    printf("Legacy main-MTA / fresh worker control: HRESULT=0x%08lx\n",static_cast<unsigned long>(hr));
    if(factory) factory->Release();
 });implicitMta.join();
 if(SUCCEEDED(mainApartment)) CoUninitialize();
 std::thread worker([&]{
    unsigned char pixels[4*4*3];memset(pixels,127,sizeof(pixels));
    auto png=root/L"漫画 العربية %! image.png";
    auto jpg=root/L"漫画 العربية %! image.jpg";
    if(!wic_encode_image(png.c_str(),4,4,3,pixels) || !wic_encode_jpeg_image(jpg.c_str(),4,4,3,pixels)) return;
    for(const auto& file : {png,jpg}) {
      int w=0,h=0,c=0;auto data=wic_decode_image(file.c_str(),&w,&h,&c);
      if(!data || w!=4 || h!=4 || c!=3) {free(data);return;}free(data);
    }
    passed=true;
 });worker.join();
 if(!passed) return 4;
 std::thread decoder([&]{ int w,h,c;auto data=wic_decode_image((root/L"漫画 العربية %! image.jpg").c_str(),&w,&h,&c);passed=data!=nullptr;free(data); });decoder.join();
 if(!passed) return 5;
 printf("WIC PNG/JPG worker decode/encode regression passed. No GPU inference tested.\n");
 return 0;
}
