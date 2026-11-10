// Row-at-a-time PNG output using pinned libpng/zlib. No second full-image buffer.
#pragma once
#include <png.h>
#include <cstdio>
#include <cstdint>
#include <filesystem>
#include <limits>
namespace jm {
inline bool png_stream(const std::filesystem::path& file,int width,int height,int channels,
                       const unsigned char* pixels,size_t stride,bool bgr,int compression=6) {
    if(!pixels||width<=0||height<=0||(channels!=3&&channels!=4)||
       (uint64_t)width>PNG_UINT_31_MAX||(uint64_t)height>PNG_UINT_31_MAX||
       (size_t)width>std::numeric_limits<size_t>::max()/(size_t)channels||
       stride<(size_t)width*channels||(size_t)height>std::numeric_limits<size_t>::max()/stride)return false;
#if _WIN32
    FILE* fp=_wfopen(file.c_str(),L"wb");
#else
    FILE* fp=fopen(file.c_str(),"wb");
#endif
    if(!fp)return false;
    png_structp png=png_create_write_struct(PNG_LIBPNG_VER_STRING,nullptr,nullptr,nullptr);
    if(!png){fclose(fp);return false;}
    png_infop info=png_create_info_struct(png);
    if(!info){png_destroy_write_struct(&png,nullptr);fclose(fp);return false;}
    // No C++ objects with destructors are constructed across libpng's longjmp.
    if(setjmp(png_jmpbuf(png))){png_destroy_write_struct(&png,&info);fclose(fp);return false;}
    png_init_io(png,fp);
    png_set_IHDR(png,info,width,height,8,channels==4?PNG_COLOR_TYPE_RGBA:PNG_COLOR_TYPE_RGB,
                 PNG_INTERLACE_NONE,PNG_COMPRESSION_TYPE_BASE,PNG_FILTER_TYPE_BASE);
    png_set_compression_level(png,compression<0?0:compression>9?9:compression);
    png_write_info(png,info);
    if(bgr)png_set_bgr(png);
    for(int row=0;row<height;row++)png_write_row(png,pixels+(size_t)row*stride);
    png_write_end(png,info);png_destroy_write_struct(&png,&info);
    const bool flushed=fflush(fp)==0;const bool closed=fclose(fp)==0;
    return flushed&&closed;
}
}
