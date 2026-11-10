// Opt-in whole-image pipeline. The legacy batch queues do not enter this path.
// Capacity one is intentional for the first review build: long-page buffers can
// exceed hundreds of MB. Admission is held through durable host adoption/ACK.
#pragma once
#include <memory>
#include <sstream>
#include <array>
namespace jm5 {
struct Entry { fs::path source, output, checkpoint; int width=0,height=0,resume=1; };
inline void trace(const char* stage,int id){std::lock_guard<std::mutex> lock(jm::events);printf("@JM5 %s %d\n",stage,id);fflush(stdout);}
inline bool acknowledge(int id,const char* stage){
    const auto file=jm::control/(std::to_string(id)+"."+stage+".ack");
    auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(180);
    while(!fs::exists(file)){
        if(std::chrono::steady_clock::now()>deadline)return false;
        std::error_code ec;auto lease=fs::last_write_time(jm::control/"lease",ec);
        if(ec||fs::file_time_type::clock::now()-lease>std::chrono::seconds(15))return false;
        if(fs::exists(jm::control/(std::to_string(id)+".reject")))return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return true;
}
inline std::vector<Entry> entries(const fs::path& manifest){
    std::ifstream in(manifest);std::vector<Entry> result;std::string line;
    while(std::getline(in,line)){
        if(!line.empty()&&line.back()=='\r')line.pop_back();
        std::istringstream stream(line);std::array<std::string,6> fields;for(auto& field:fields)if(!std::getline(stream,field,'\t'))return {};
        Entry e;e.source=fs::u8path(jm::unhex(fields[0]));e.output=fs::u8path(jm::unhex(fields[1]));e.checkpoint=fs::u8path(jm::unhex(fields[2]));
        try{e.width=std::stoi(fields[3]);e.height=std::stoi(fields[4]);e.resume=std::stoi(fields[5]);}catch(...){return {};}
        if(!e.source.is_absolute()||!e.output.is_absolute()||!e.checkpoint.is_absolute()||e.source==e.output||e.width<=0||e.height<=0||(e.resume!=1&&e.resume!=2))return {};
        result.push_back(e);
    }return result;
}
inline unsigned char* decode(const fs::path& file,int& w,int& h,int& c){
#if _WIN32
    FILE* fp=_wfopen(file.c_str(),L"rb");
#else
    FILE* fp=fopen(file.c_str(),"rb");
#endif
    if(!fp)return nullptr;std::unique_ptr<FILE,decltype(&fclose)> handle(fp,fclose);
    if(fseek(fp,0,SEEK_END))return nullptr;long length=ftell(fp);if(length<=0||length>INT_MAX)return nullptr;rewind(fp);
    std::vector<unsigned char> bytes((size_t)length);if(fread(bytes.data(),1,bytes.size(),fp)!=bytes.size())return nullptr;
    unsigned char* pixels=webp_load(bytes.data(),(int)length,&w,&h,&c);if(pixels)return pixels;
#if _WIN32
    return wic_decode_image(file.c_str(),&w,&h,&c);
#else
    pixels=stbi_load_from_memory(bytes.data(),(int)length,&w,&h,&c,0);
    if(pixels&&(c==1||c==2)){int requested=c==1?3:4;stbi_image_free(pixels);pixels=stbi_load_from_memory(bytes.data(),(int)length,&w,&h,&c,requested);c=requested;}return pixels;
#endif
}
inline bool dimensions(int64_t w,int64_t h){return w>0&&h>0&&w<=INT_MAX/4&&h<=INT_MAX&&w*h<=INT_MAX/4;}
struct Models {
    int gpu,tile,tta,precision;bool resident;std::array<fs::path,2> params,bins;std::array<int,2> scales,alignments;
    std::array<std::unique_ptr<RealESRGAN>,2> nets;std::array<int,2> loads{0,0};
    RealESRGAN* get(int stage){
        if(nets[stage])return nets[stage].get();
        if(!resident)nets[1-stage].reset();
        auto load=[&](){auto net=std::make_unique<RealESRGAN>(gpu,tta,(precision&(1<<stage))!=0);if(net->load(params[stage].native(),bins[stage].native()))return std::unique_ptr<RealESRGAN>{};net->scale=scales[stage];net->tilesize=tile;net->prepadding=10;net->input_multiple=alignments[stage];return net;};
        nets[stage]=load();
        if(!nets[stage]&&resident&&nets[1-stage]){nets[1-stage].reset();resident=false;fprintf(stderr,"[two-stage] resident load failed; switching to one resident model (reload cost per stage)\n");nets[stage]=load();}
        if(nets[stage])fprintf(stderr,"[two-stage] model-load stage=%d count=%d mode=%s\n",stage+1,++loads[stage],resident?"two-resident":"one-resident");return nets[stage].get();
    }
};
inline int worker(const fs::path& manifest,const fs::path& directory,const fs::path& name,const fs::path& directory2,const fs::path& name2,int scale,int scale2,int alignment,int alignment2,int gpu,int tile,int tta,int precision,SaveThreadParams stp){
    auto list=entries(manifest);if(list.empty()||jm::control.empty()){fprintf(stderr,"[two-stage] invalid v2 manifest/control\n");return 2;}
    Models models;models.gpu=gpu;models.tile=tile;models.tta=tta;models.precision=precision;models.scales={scale,scale2};models.alignments={alignment,alignment2};
    models.params={directory/(name.native()+PATHSTR(".param")),directory2/(name2.native()+PATHSTR(".param"))};models.bins={directory/(name.native()+PATHSTR(".bin")),directory2/(name2.native()+PATHSTR(".bin"))};
    uint64_t weights=0;std::error_code ec;for(auto& bin:models.bins){auto bytes=fs::file_size(bin,ec);if(ec){fprintf(stderr,"[two-stage] model file missing\n");return 2;}weights+=bytes;}
    // Conservative admission estimate, not a promise about actual driver VRAM.
    const double workspace=(tta?2048.:512.)*tile*tile/10000.;
    models.resident=ncnn::get_gpu_device(gpu)->get_heap_budget()>weights*8./1048576.+workspace+512.;
    fprintf(stderr,"[two-stage] capacity=1 admission-until=durable-final-ack model-memory=%s estimated-workspace-MiB=%.0f\n",models.resident?"two-resident":"one-resident-reload",workspace);
    for(size_t i=0;i<list.size();++i){
        if(!jm::admit())break;const auto& entry=list[i];int id=(int)i;trace("ADMIT",id);
        auto failed=[&](const char* stage,int code){jm::event(id,false,stage,code);acknowledge(id,"final");trace("RELEASE",id);};
        const int64_t width1=(int64_t)entry.width*scale,height1=(int64_t)entry.height*scale;
        if(!dimensions(entry.width,entry.height)||!dimensions(width1,height1)||!dimensions(width1*scale2,height1*scale2)){failed("dimensions",-1);continue;}
        try{
            int w=0,h=0,c=0;auto input=entry.resume==2?entry.checkpoint:entry.source;
#if _WIN32
            jm_wic_image_id=id;
#endif
            std::unique_ptr<unsigned char,decltype(&free)> pixels(decode(input,w,h,c),free);
            if(!pixels||c<3||c>4||w!=(entry.resume==2?width1:entry.width)||h!=(entry.resume==2?height1:entry.height)){failed("decode",-1);continue;}
            ncnn::Mat image(w,h,pixels.get(),(size_t)c,c),middle;
            if(entry.resume==1){
                if(!jm::begin_inference(id)){trace("RELEASE",id);break;}trace("STAGE1",id);
                auto net=models.get(0);middle.create((int)width1,(int)height1,(size_t)c,c);
                int code=!net||middle.empty()?-1:net->process(image,middle);jm::end_inference(id);
                if(code){failed("stageone",code);continue;}
                const auto pending=fs::path(entry.checkpoint.native()+PATHSTR(".pending.png"));
                bool ok=jm::png_stream(pending,middle.w,middle.h,c,(const unsigned char*)middle.data,(size_t)middle.w*c,
#if _WIN32
                    true,
#else
                    false,
#endif
                    6);
                if(!ok){failed("checkpoint",-1);continue;}
                trace("CHECKPOINT",id);
                if(!acknowledge(id,"stage1")){trace("RELEASE",id);break;}
                image=middle;pixels.reset();
            }
            if(!jm::begin_inference(id)){trace("RELEASE",id);break;}trace("STAGE2",id);
            Task output;output.id=id;output.managed_input=true;output.original_w=entry.width;output.original_h=entry.height;output.inpath=entry.source.native();output.outpath=entry.output.native();output.inimage=image;
            output.outimage.create((int)width1*scale2,(int)height1*scale2,(size_t)c,c);
            auto net=models.get(1);int code=!net||output.outimage.empty()?-1:net->process(image,output.outimage);jm::end_inference(id);
            if(code){failed("stagetwo",code);continue;}
            trace("VERIFY",id);
            // Reuse exactly the final resize/encoder path used by Single/batch.
            tosave.put(output);Task end;end.id=-233;tosave.put(end);save(&stp);
            if(!acknowledge(id,"final")){trace("RELEASE",id);break;}
            trace("RELEASE",id);
        }catch(const std::exception& error){fprintf(stderr,"[two-stage] image=%d exception=%s\n",id,error.what());failed("allocation",-1);}
    }
    fprintf(stderr,"[two-stage] model-load-total first=%d second=%d\n",models.loads[0],models.loads[1]);return jm::failed?2:0;
}
}
