// Real libpng row writer/full decoder, no GPU. 1440x70200 is the reported output.
#include <filesystem>
#include <vector>
#include <cstdio>
#include <stdexcept>
#include "png_stream.h"
void verify(const std::filesystem::path& path,int w,int h,bool alpha){
#if _WIN32
 FILE* fp=_wfopen(path.c_str(),L"rb");
#else
 FILE* fp=fopen(path.c_str(),"rb");
#endif
 if(!fp)throw std::runtime_error("output missing");
 auto png=png_create_read_struct(PNG_LIBPNG_VER_STRING,nullptr,nullptr,nullptr);auto info=png_create_info_struct(png);
 if(setjmp(png_jmpbuf(png)))throw std::runtime_error("PNG full decode failed");
 png_init_io(png,fp);png_read_info(png,info);
 if(png_get_image_width(png,info)!=(unsigned)w||png_get_image_height(png,info)!=(unsigned)h)throw std::runtime_error("dimensions changed");
 std::vector<unsigned char> row(png_get_rowbytes(png,info));
 for(int y=0;y<h;y++){png_read_row(png,row.data(),nullptr);for(int x=0;x<w;x++){int c=alpha?4:3;if(row[x*c]!=17||row[x*c+1]!=83||row[x*c+2]!=201||(alpha&&row[x*c+3]!=127))throw std::runtime_error("pixels/colors changed");}}
 png_read_end(png,info);png_destroy_read_struct(&png,&info,nullptr);fclose(fp);
}
int main(int argc,char** argv){
 if(argc!=2)return 2;const std::filesystem::path root=argv[1];std::filesystem::create_directories(root);
 for(const auto shape: {std::pair<int,int>{8,8},{1440,70200},{8,65535},{8,65536}}){
  const auto [w,h]=shape;std::vector<unsigned char> data((size_t)w*h*3);
  for(size_t p=0;p<data.size();p+=3){data[p]=201;data[p+1]=83;data[p+2]=17;}
  auto file=root/(std::to_string(w)+"x"+std::to_string(h)+".png");
  if(!jm::png_stream(file,w,h,3,data.data(),(size_t)w*3,true))return 3;
  verify(file,w,h,false);
 }
 std::vector<unsigned char> alpha(8*8*4);for(size_t p=0;p<alpha.size();p+=4){alpha[p]=201;alpha[p+1]=83;alpha[p+2]=17;alpha[p+3]=127;}
 if(!jm::png_stream(root/"alpha.png",8,8,4,alpha.data(),32,true))return 4;verify(root/"alpha.png",8,8,true);
 if(jm::png_stream(root/"missing"/"bad.png",8,8,4,alpha.data(),32,true))return 5;
#ifndef _WIN32
 if(jm::png_stream("/dev/full",8,8,4,alpha.data(),32,true))return 6;
#endif
 if(jm::png_stream(root/"bad-dimensions.png",0,8,4,alpha.data(),32,true))return 7;
 printf("::notice title=Streaming PNG::1440x70200 and 65535/65536 boundaries decoded fully; BGR/alpha verified; write failures rejected. No GPU.\n");
 return 0;
}
