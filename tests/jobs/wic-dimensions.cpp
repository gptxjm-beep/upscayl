// Standalone OS-codec probe, deliberately independent of the modified engine.
#include <windows.h>
#include <wincodec.h>
#include <cstdio>
#include <vector>
#include <algorithm>
void probe(int w,int h,bool jpeg,bool pixelFirst,bool writeImage){
 IWICImagingFactory* factory=nullptr;IWICBitmapEncoder* encoder=nullptr;IWICBitmapFrameEncode* frame=nullptr;IStream* stream=nullptr;
 HRESULT hr=CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory));
 const char* stage="factory";HRESULT size=E_PENDING,pixel=E_PENDING,write=E_PENDING,commit=E_PENDING;
 WICPixelFormatGUID format=GUID_WICPixelFormat24bppBGR;
 if(SUCCEEDED(hr)){stage="stream";hr=CreateStreamOnHGlobal(nullptr,TRUE,&stream);}
 if(SUCCEEDED(hr)){stage="encoder";hr=factory->CreateEncoder(jpeg?GUID_ContainerFormatJpeg:GUID_ContainerFormatPng,nullptr,&encoder);}
 if(SUCCEEDED(hr)){stage="initialize";hr=encoder->Initialize(stream,WICBitmapEncoderNoCache);}
 if(SUCCEEDED(hr)){stage="frame";hr=encoder->CreateNewFrame(&frame,nullptr);}
 if(SUCCEEDED(hr)){stage="frame-initialize";hr=frame->Initialize(nullptr);}
 if(SUCCEEDED(hr)&&pixelFirst){stage="pixel-first";pixel=hr=frame->SetPixelFormat(&format);}
 if(SUCCEEDED(hr)){stage="set-size";size=hr=frame->SetSize(w,h);}
 if(SUCCEEDED(hr)&&!pixelFirst){stage="pixel-after";pixel=hr=frame->SetPixelFormat(&format);}
 if(SUCCEEDED(hr)&&writeImage){
  const UINT stride=w*3;std::vector<BYTE> rows(stride*64,127);write=S_OK;
  for(UINT y=0;y<(UINT)h&&SUCCEEDED(write);){const UINT count=std::min<UINT>(64,h-y);write=frame->WritePixels(count,stride,count*stride,rows.data());y+=count;}
  stage="write";hr=write;
  if(SUCCEEDED(hr)){stage="commit";commit=hr=frame->Commit();if(SUCCEEDED(hr))commit=hr=encoder->Commit();}
 }
 printf("::notice title=WIC dimensions::codec=%s width=%d height=%d pixelFirst=%d setSize=0x%08lx pixel=0x%08lx write=0x%08lx commit=0x%08lx final=0x%08lx stage=%s\n",jpeg?"jpeg":"png",w,h,pixelFirst,(unsigned long)size,(unsigned long)pixel,(unsigned long)write,(unsigned long)commit,(unsigned long)hr,stage);
 if(frame)frame->Release();if(encoder)encoder->Release();if(stream)stream->Release();if(factory)factory->Release();
}
int main(){
 HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED);if(FAILED(hr))return 2;
 const int sizes[][2]={{720,29700},{1440,59400},{2880,118800},{1440,65535},{1440,65536},{0,59400},{4,4}};
 for(bool jpeg:{false,true})for(bool first:{false,true})for(const auto& size:sizes)probe(size[0],size[1],jpeg,first,size[0]==1440&&size[1]==59400);
 CoUninitialize();return 0;
}
