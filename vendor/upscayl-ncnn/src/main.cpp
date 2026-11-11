// realesrgan implemented with ncnn library
#include <iostream>
#include <stdio.h>
#include <algorithm>
#include <queue>
#include <vector>
#include <clocale>
#include <filesystem>
#include <limits>
#include <climits>
#include <cerrno>
#include "session.h"
#include "png_stream.h"

namespace fs = std::filesystem;

#if _WIN32
// image decoder and encoder with wic
#include "wic_image.h"
#else // _WIN32
// image decoder and encoder with stb
#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_PSD
#define STBI_NO_TGA
#define STBI_NO_GIF
#define STBI_NO_HDR
#define STBI_NO_PIC
#define STBI_NO_STDIO
#include "stb_image.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"
#endif // _WIN32
#include "webp_image.h"
#define STB_IMAGE_RESIZE2_IMPLEMENTATION
#include "stb_image_resize2.h"

static const char *resizemodes[] = {
    "default",      // STBIR_FILTER_DEFAULT
    "box",          // STBIR_FILTER_BOX
    "triangle",     // STBIR_FILTER_TRIANGLE
    "cubicbspline", // STBIR_FILTER_CUBICBSPLINE
    "catmullrom",   // STBIR_FILTER_CATMULLROM
    "mitchell",     // STBIR_FILTER_MITCHELL
    "pointsample"   // STBIR_FILTER_POINT_SAMPLE
};

#if _WIN32
#include <wchar.h>
static wchar_t *optarg = NULL;
static int optind = 1;
static wchar_t getopt(int argc, wchar_t *const argv[], const wchar_t *optstring)
{
    if (optind >= argc || argv[optind][0] != L'-')
        return -1;

    wchar_t opt = argv[optind][1];
    const wchar_t *p = wcschr(optstring, opt);
    if (p == NULL)
        return L'?';

    optarg = NULL;

    if (p[1] == L':')
    {
        optind++;
        if (optind >= argc)
            return L'?';

        optarg = argv[optind];
    }

    optind++;

    return opt;
}

static std::vector<int> parse_optarg_int_array(const wchar_t *optarg)
{
    std::vector<int> array;
    array.push_back(_wtoi(optarg));

    const wchar_t *p = wcschr(optarg, L',');
    while (p)
    {
        p++;
        array.push_back(_wtoi(p));
        p = wcschr(p, L',');
    }

    return array;
}

static bool ascii_string_equals(const wchar_t *wide, const char *narrow)
{
    size_t widelen = wcslen(wide);
    size_t narrowlen = strlen(narrow);

    if (widelen != narrowlen)
        return false;

    for (size_t i = 0; i < widelen; i++)
    {
        if (wide[i] != narrow[i])
            return false;
    }

    return true;
}

static bool parse_optarg_resize(const wchar_t *optarg, int *width, int *height, int *mode, bool hasCustomWidth = false)
{
    *mode = 0; // default

    const wchar_t *colon = wcschr(optarg, L':');
    if (colon)
    {
        bool found = false;
        const wchar_t *modestr = colon + 1;
        for (int i = 0; i < (int)(sizeof(resizemodes) / sizeof(resizemodes[0])); i++)
        {
            if (ascii_string_equals(modestr, resizemodes[i]))
            {
                *mode = i;
                found = true;
                break;
            }
        }
        if (!found)
        {
            fwprintf(stderr, L"🚨 Error: Invalid resize mode '%s'\n", modestr);
            return false;
        }
    }

    if (hasCustomWidth)
    {
        return swscanf(optarg, L"%d", width) == 1;
    }

    return swscanf(optarg, L"%dx%d", width, height) == 2;
}

#else               // _WIN32
#include <unistd.h> // getopt()

static std::vector<int> parse_optarg_int_array(const char *optarg)
{
    std::vector<int> array;
    array.push_back(atoi(optarg));

    const char *p = strchr(optarg, ',');
    while (p)
    {
        p++;
        array.push_back(atoi(p));
        p = strchr(p, ',');
    }

    return array;
}

static bool parse_optarg_resize(const char *optarg, int *width, int *height, int *mode, bool hasCustomWidth = false)
{
    *mode = 0; // default

    const char *colon = strchr(optarg, ':');
    if (colon)
    {
        bool found = false;
        const char *modestr = colon + 1;
        for (int i = 0; i < (int)(sizeof(resizemodes) / sizeof(resizemodes[0])); i++)
        {
            if (strcmp(modestr, resizemodes[i]) == 0)
            {
                *mode = i;
                found = true;
                break;
            }
        }
        if (!found)
        {
            fprintf(stderr, "🚨 Error: Invalid resize mode '%s'\n", modestr);
            return false;
        }
    }
    if (hasCustomWidth)
    {
        return sscanf(optarg, "%d", width) == 1;
    }
    return sscanf(optarg, "%dx%d", width, height) == 2;
}

#endif // _WIN32

// ncnn
#include "cpu.h"
#include "gpu.h"
#include "platform.h"
#include "realesrgan.h"

#include "filesystem_utils.h"

static void print_usage()
{
    fprintf(stderr, "Usage: upscayl-bin -i infile -o outfile [options]...\n\n");
    fprintf(stderr, "  -h                   show this help\n");
    fprintf(stderr, "  -i input-path        input image path (jpg/png/webp) or directory\n");
    fprintf(stderr, "  -o output-path       output image path (jpg/png/webp) or directory\n");
    fprintf(stderr, "  -z model-scale       scale according to the model (can be 2, 3, 4. default=4)\n");
    fprintf(stderr, "  -s output-scale      custom output scale (can be 2, 3, 4. default=4)\n");
    fprintf(stderr, "  -r resize            resize output to dimension (default=WxH:default), use '-r help' for more details\n");
    fprintf(stderr, "  -w width             resize output to a width (default=W:default), use '-r help' for more details\n");
    fprintf(stderr, "  -c compress          compression of the output image, default 0 and varies to 100\n");
    fprintf(stderr, "  -t tile-size         tile size (>=32/0=auto, default=0) can be 0,0,0 for multi-gpu\n");
    fprintf(stderr, "  -m model-path        folder path to the pre-trained models. default=models\n");
    fprintf(stderr, "  -n model-name        model name (default=realesrgan-x4plus, can be realesr-animevideov3 | realesrgan-x4plus-anime | realesrnet-x4plus or any other model)\n");
    fprintf(stderr, "  -g gpu-id            gpu device to use (default=auto) can be 0,1,2 for multi-gpu\n");
    fprintf(stderr, "  -j load:proc:save    thread count for load/proc/save (default=1:2:2) can be 1:2,2,2:2 for multi-gpu\n");
    fprintf(stderr, "  -x                   enable tta mode\n");
    fprintf(stderr, "  -f format            output image format (jpg/png/webp, default=ext/png)\n");
    fprintf(stderr, "  -v                   verbose output\n");
}

static void print_resize_usage()
{
    printf("'-r widthxheight:filter' argument usage:\n\n");

    printf("For example '-r 1920x1080' or '-r 1920x1080:default' will force all output images to be\n");
    printf("resized to 1920x1080 with the default filter if they aren't already.\n");
    printf("Similarly, '-w 1920' will force all output images to be resized to a width of 1920.\n\n");

    printf("Avaliable filters:\n");
    printf("  default       - Automatically decide\n");
    printf("  box           - A trapezoid w/1-pixel wide ramps, same result as box for integer scale ratios\n");
    printf("  triangle      - On upsampling, produces same results as bilinear texture filtering\n");
    printf("  cubicbspline  - The cubic b-spline (aka Mitchell-Netrevalli with B=1,C=0), gaussian-esque\n");
    printf("  catmullrom    - An interpolating cubic spline\n");
    printf("  mitchell      - Mitchell-Netrevalli filter with B=1/3, C=1/3\n");
    printf("  pointsample   - Simple point sampling\n");
}

class Task
{
public:
    int id;
    int webp;
    bool managed_input=false;
    int original_w=0,original_h=0;

    path_t inpath;
    path_t outpath;

    ncnn::Mat inimage;
    ncnn::Mat outimage;
};

class TaskQueue
{
public:
    TaskQueue()
    {
    }

    void put(const Task &v)
    {
        lock.lock();

        while (tasks.size() >= 8) // FIXME hardcode queue length
        {
            not_full.wait(lock);
        }

        tasks.push(v);

        lock.unlock();

        not_empty.signal();
    }

    void get(Task &v)
    {
        lock.lock();

        while (tasks.size() == 0)
        {
            not_empty.wait(lock);
        }

        v = tasks.front();
        tasks.pop();

        lock.unlock();

        not_full.signal();
    }

private:
    ncnn::Mutex lock;
    ncnn::ConditionVariable not_empty;
    ncnn::ConditionVariable not_full;
    std::queue<Task> tasks;
};

TaskQueue toproc;
TaskQueue tosave;

class LoadThreadParams
{
public:
    int scale;
    int jobs_load;

    // session data
    std::vector<path_t> input_files;
    std::vector<path_t> output_files;
};

void *load(void *args)
{
    const LoadThreadParams *ltp = (const LoadThreadParams *)args;
    const int count = ltp->input_files.size();
    const int scale = ltp->scale;

#pragma omp parallel for schedule(static, 1) num_threads(ltp->jobs_load)
    for (int i = 0; i < count; i++)
    {
        if (!jm::admit()) continue; // admitted images drain through the original pipeline
        const path_t &imagepath = ltp->input_files[i];

        int webp = 0;

        unsigned char *pixeldata = 0;
        int w;
        int h;
        int c;

#if _WIN32
        FILE *fp = _wfopen(imagepath.c_str(), L"rb");
#else
        FILE *fp = fopen(imagepath.c_str(), "rb");
#endif
        if (fp)
        {
            // read whole file
            unsigned char *filedata = 0;
            int length = 0;
            {
                fseek(fp, 0, SEEK_END);
                length = ftell(fp);
                rewind(fp);
                filedata = (unsigned char *)malloc(length);
                if (filedata)
                {
                    fread(filedata, 1, length, fp);
                }
                fclose(fp);
            }

            if (filedata)
            {
                pixeldata = webp_load(filedata, length, &w, &h, &c);
                if (pixeldata)
                {
                    webp = 1;
                }
                else
                {
                    // not webp, try jpg png etc.
#if _WIN32
                    jm_wic_image_id=i;
                    pixeldata = wic_decode_image(imagepath.c_str(), &w, &h, &c);
#else  // _WIN32
                    pixeldata = stbi_load_from_memory(filedata, length, &w, &h, &c, 0);
                    if (pixeldata)
                    {
                        // stb_image auto channel
                        if (c == 1)
                        {
                            // grayscale -> rgb
                            stbi_image_free(pixeldata);
                            pixeldata = stbi_load_from_memory(filedata, length, &w, &h, &c, 3);
                            c = 3;
                        }
                        else if (c == 2)
                        {
                            // grayscale + alpha -> rgba
                            stbi_image_free(pixeldata);
                            pixeldata = stbi_load_from_memory(filedata, length, &w, &h, &c, 4);
                            c = 4;
                        }
                    }
#endif // _WIN32
                }

                free(filedata);
            }
        }
        if (pixeldata)
        {
            Task v;
            v.id = i;
            v.webp = webp;
            v.inpath = imagepath;
            v.outpath = ltp->output_files[i];

            v.inimage = ncnn::Mat(w, h, (void *)pixeldata, (size_t)c, c);
            v.outimage = ncnn::Mat(w * scale, h * scale, (size_t)c, c);

            path_t ext = get_file_extension(v.outpath);
            if (c == 4 && (ext == PATHSTR("jpg") || ext == PATHSTR("JPG") || ext == PATHSTR("jpeg") || ext == PATHSTR("JPEG")))
            {
                path_t output_filename2 = get_file_name_without_extension(ltp->output_files[i]) + PATHSTR('.') + ext;
                v.outpath = output_filename2;
#if _WIN32
                fwprintf(stderr, L"ℹ️ Info: Image %s has alpha channel!\n", imagepath.c_str());
#else  // _WIN32
                fprintf(stderr, "ℹ️ Info: Image %s has alpha channel!\n", imagepath.c_str());
#endif // _WIN32
            }

            jm::trace("LOAD",v.id);
            toproc.put(v);
        }
        else
        {
            jm::event(i, false, "decode", -1);
#if _WIN32
            fwprintf(stderr, L"🚨 Error: Couldn't read the image '%s'!\n", imagepath.c_str());
#else  // _WIN32
            fprintf(stderr, "🚨 Error: Couldn't read the image '%s'!\n", imagepath.c_str());
#endif // _WIN32
        }
    }

    return 0;
}

class ProcThreadParams
{
public:
    const RealESRGAN *realesrgan;
};

void *proc(void *args)
{
    const ProcThreadParams *ptp = (const ProcThreadParams *)args;
    const RealESRGAN *realesrgan = ptp->realesrgan;

    for (;;)
    {
        Task v;

        toproc.get(v);

        if (v.id == -233)
            break;

        if (!jm::begin_inference(v.id)) {
            // Input storage is external to Mat. Output storage is owned by Mat
            // and released by v's destructor; neither task reached the GPU.
            free(v.inimage.data);
            continue;
        }
        int result = realesrgan->process(v.inimage, v.outimage);
        jm::end_inference(v.id);
        static std::atomic<int> consecutive_inference_failures{0};
        if(result != 0) {if(++consecutive_inference_failures>=3)jm::fatal("inference-global",result);jm::event(v.id, false, "inference", result);}
        else consecutive_inference_failures=0;

        if(result == 0) tosave.put(v);
        else { free(v.inimage.data); }
    }

    return 0;
}

class SaveThreadParams
{
public:
    int resizeWidth;
    int resizeHeight;
    int resizeMode;
    bool resizeProvided;
    int outputScale;
    bool hasOutputScale;
    bool hasCustomWidth;
    float compression;
    int verbose;
};

// Own resized storage through Mat: external malloc-backed Mats do not free
// their pixel buffer. Reject bad dimensions/allocation instead of encoding it.
bool resize_pixels(Task& v, int64_t width, int64_t height)
{
    const int c=v.outimage.elempack;
    if(width<=0 || height<=0 || width>INT_MAX || height>INT_MAX || (c!=3 && c!=4) || width>INT_MAX/c || width*height>INT_MAX/c) {
        fprintf(stderr,"[resize] image=%d invalid or unsupported dimensions width=%lld height=%lld channels=%d\n",v.id,(long long)width,(long long)height,c);return false;
    }
    ncnn::Mat resized((int)width,(int)height,(size_t)c,c);
    if(resized.empty()) {fprintf(stderr,"[resize] image=%d allocation failed width=%lld height=%lld channels=%d\n",v.id,(long long)width,(long long)height,c);return false;}
    if(!stbir_resize_uint8_srgb((unsigned char*)v.outimage.data,v.outimage.w,v.outimage.h,0,(unsigned char*)resized.data,(int)width,(int)height,0,static_cast<stbir_pixel_layout>(c))) {
        fprintf(stderr,"[resize] image=%d pixel resize failed\n",v.id);return false;
    }
    v.outimage=resized;return true;
}
bool resize_output_image(Task& v,const SaveThreadParams* stp)
{
    if(!stp->resizeProvided&&!stp->hasCustomWidth)return true;
    if(v.inimage.w<=0||v.inimage.h<=0)return false;
    const int iw=v.original_w?v.original_w:v.inimage.w,ih=v.original_h?v.original_h:v.inimage.h;
    const int64_t height=stp->hasCustomWidth ? (int64_t)ih*stp->resizeWidth/iw : stp->resizeHeight;
    if(v.outimage.w==stp->resizeWidth&&v.outimage.h==height)return true;
    return resize_pixels(v,stp->resizeWidth,height);
}
bool scale_output_image(Task& v,const SaveThreadParams* stp)
{
    if(!stp->hasOutputScale||stp->resizeProvided||stp->hasCustomWidth)return true;
    return resize_pixels(v,(int64_t)(v.original_w?v.original_w:v.inimage.w)*stp->outputScale,(int64_t)(v.original_h?v.original_h:v.inimage.h)*stp->outputScale);
}

void *save(void *args)
{
    const SaveThreadParams *stp = (const SaveThreadParams *)args;
    const int verbose = stp->verbose;

    for (;;)
    {
        Task v;

        tosave.get(v);

        if (v.id == -233)
            break;

        const int inferred_width=v.outimage.w,inferred_height=v.outimage.h;
        // Legacy tasks own an external input buffer; v2 tasks use RAII.
        if(!v.managed_input) {
            unsigned char *pixeldata = (unsigned char *)v.inimage.data;
            if (v.webp == 1)
            {
                free(pixeldata);
            }
            else
            {
#if _WIN32
                free(pixeldata);
#else
                stbi_image_free(pixeldata);
#endif
            }
        }

        if (stp->hasOutputScale)
        {
            if(!scale_output_image(v, stp)){jm::event(v.id,false,"resize",-1);continue;}
        }

        if ((stp->resizeProvided || stp->hasCustomWidth) && !stp->hasOutputScale)
        {
            if(!resize_output_image(v, stp)){jm::event(v.id,false,"resize",-1);continue;}
        }

        if(v.outimage.empty()||v.outimage.w<=0||v.outimage.h<=0){fprintf(stderr,"[encode] image=%d invalid output dimensions width=%d height=%d\n",v.id,v.outimage.w,v.outimage.h);jm::event(v.id,false,"encode",-1);continue;}
#if _WIN32
        jm_wic_image_id=v.id;jm_wic_last_error=S_OK;
#endif
        int success = 0;
        errno=0;
#if _WIN32
        SetLastError(ERROR_SUCCESS);
#endif

        path_t ext = get_file_extension(v.outpath);

        /* ----------- Create folder if not exists -------------------*/
        fs::path fs_path = fs::absolute(v.outpath);
#if _WIN32
        std::wstring parent_path = fs_path.parent_path().wstring();
#else
        std::string parent_path = fs_path.parent_path().string();
#endif

        if (!fs::exists(parent_path))
        {
            fprintf(stderr, "📂 Creating directory: %s\n", parent_path.c_str());
            fs::create_directories(parent_path);
        }

        if (ext == PATHSTR("webp") || ext == PATHSTR("WEBP"))
        {
            success = webp_save(v.outpath.c_str(), v.outimage.w, v.outimage.h, v.outimage.elempack, (const unsigned char *)v.outimage.data, 100 - (int)stp->compression);
        }
        else if (ext == PATHSTR("png") || ext == PATHSTR("PNG"))
        {
#if _WIN32
            static std::atomic<bool> normal_encoder_reported{false};
            const bool long_png=v.outimage.w>65535||v.outimage.h>65535;
            if(long_png) {
                fprintf(stderr,"[PNG] image=%d encoder=libpng width=%d height=%d reason=wic-dimension-preflight\n",v.id,v.outimage.w,v.outimage.h);
                success=jm::png_stream(v.outpath,v.outimage.w,v.outimage.h,v.outimage.elempack,(unsigned char*)v.outimage.data,(size_t)v.outimage.w*v.outimage.elempack,true,stp->compression>0?std::min(9,(int)stp->compression):6);
            }else{
                if(!normal_encoder_reported.exchange(true))fprintf(stderr,"[PNG] encoder=WIC width=%d height=%d reason=normal-size\n",v.outimage.w,v.outimage.h);
                success = wic_encode_image(v.outpath.c_str(), v.outimage.w, v.outimage.h, v.outimage.elempack, v.outimage.data);
                if(!success&&jm_wic_last_error==WINCODEC_ERR_IMAGESIZEOUTOFRANGE){
                    fprintf(stderr,"[PNG] image=%d encoder=libpng width=%d height=%d reason=wic-dimension-rejection HRESULT=0x%08lx\n",v.id,v.outimage.w,v.outimage.h,(unsigned long)jm_wic_last_error);
                    success=jm::png_stream(v.outpath,v.outimage.w,v.outimage.h,v.outimage.elempack,(unsigned char*)v.outimage.data,(size_t)v.outimage.w*v.outimage.elempack,true,stp->compression>0?std::min(9,(int)stp->compression):6);
                }
            }
#else
            // if compression is more than 0 make stbi_write_png_compression_level = 9
            if (stp->compression > 0)
            {
                stbi_write_png_compression_level = stp->compression;
            }
            else
            {
                stbi_write_png_compression_level = 9;
            }
            if(v.outimage.w>65535||v.outimage.h>65535){
                fprintf(stderr,"[PNG] image=%d encoder=libpng width=%d height=%d reason=long-png\n",v.id,v.outimage.w,v.outimage.h);
                success=jm::png_stream(v.outpath,v.outimage.w,v.outimage.h,v.outimage.elempack,(unsigned char*)v.outimage.data,(size_t)v.outimage.w*v.outimage.elempack,false,stp->compression>0?std::min(9,(int)stp->compression):6);
            }else success = stbi_write_png(v.outpath.c_str(), v.outimage.w, v.outimage.h, v.outimage.elempack, v.outimage.data, 0);
#endif
        }
        else if (ext == PATHSTR("jpg") || ext == PATHSTR("JPG") || ext == PATHSTR("jpeg") || ext == PATHSTR("JPEG"))
        {
#if _WIN32
            success = wic_encode_jpeg_image(v.outpath.c_str(), v.outimage.w, v.outimage.h, v.outimage.elempack, v.outimage.data);
#else
            success = stbi_write_jpg(v.outpath.c_str(), v.outimage.w, v.outimage.h, v.outimage.elempack, v.outimage.data, 100 - (int)stp->compression);
#endif
        }
        static std::atomic<int> consecutive_encode_failures{0};
        const int io_error=errno;
        if(success)consecutive_encode_failures=0;
        else {
            bool disk_full=io_error==ENOSPC;
#if _WIN32
            disk_full=disk_full||jm_wic_last_error==HRESULT_FROM_WIN32(ERROR_DISK_FULL)||jm_wic_last_error==HRESULT_FROM_WIN32(ERROR_HANDLE_DISK_FULL)||jm_wic_last_error==STG_E_MEDIUMFULL||GetLastError()==ERROR_DISK_FULL;
            const bool bad_size=jm_wic_last_error==WINCODEC_ERR_IMAGESIZEOUTOFRANGE;
#else
            const bool bad_size=false;
#endif
            if(disk_full)jm::fatal("disk",io_error?io_error:112);
            else if(io_error==EACCES||io_error==EROFS)jm::fatal("destination",io_error);
            else if(!bad_size&&++consecutive_encode_failures>=3)jm::fatal("encode-global",io_error?io_error:-1);
        }
        if(!success) {
            if(io_error)fprintf(stderr,"[encode] image=%d errno=%d\n",v.id,io_error);
            const std::string name=fs::path(v.inpath).filename().u8string();
#if _WIN32
            fprintf(stderr,"[encode] image=%d name=%s input=%dx%d inferred=%dx%d final=%dx%d codec=%s HRESULT=0x%08lx\n",v.id,name.c_str(),v.inimage.w,v.inimage.h,inferred_width,inferred_height,v.outimage.w,v.outimage.h,fs::path(v.outpath).extension().u8string().c_str(),(unsigned long)jm_wic_last_error);
#else
            fprintf(stderr,"[encode] image=%d name=%s input=%dx%d inferred=%dx%d final=%dx%d codec=%s failed\n",v.id,name.c_str(),v.inimage.w,v.inimage.h,inferred_width,inferred_height,v.outimage.w,v.outimage.h,fs::path(v.outpath).extension().u8string().c_str());
#endif
        }
#if _WIN32
        jm::event(v.id,success!=0,"encode",success?0:FAILED(jm_wic_last_error)?(int)jm_wic_last_error:io_error?-io_error:-1);
#else
        jm::event(v.id, success != 0, "encode", success ? 0 : io_error?-io_error:-1);
#endif
        if (success)
        {
            fprintf(stderr, "100.00%\n");
            fprintf(stderr, "\n🙌 Upscayled Successfully!\n");

            if (verbose)
            {
#if _WIN32
                fwprintf(stderr, L"✅ %ls -> %ls done\n", v.inpath.c_str(), v.outpath.c_str());
#else
                fprintf(stderr, "✅ %s -> %s done\n", v.inpath.c_str(), v.outpath.c_str());
#endif
            }
        }
        else
        {
#if _WIN32
            fwprintf(stderr, L"🚨 Error: Couldn't write the image %s\n", v.outpath.c_str());
#else
            fprintf(stderr, "🚨 Error: Couldn't write the image %s\n", v.outpath.c_str());
#endif
        }
    }

    return 0;
}

#include "two_stage.h"

#if _WIN32
int wmain(int argc, wchar_t **argv)
#else
int main(int argc, char **argv)
#endif
{
    setlocale(LC_ALL, "");
    path_t manifestpath;
    path_t controlpath;
    path_t inputpath;
    path_t outputpath;
    int scale = 4;
    bool native_scale_provided=false;
    int input_multiple=1;
    int precision_flags=0;
    path_t second_model,second_directory,two_manifest;
    int second_scale=4,second_alignment=1;
    int resizeWidth=0;
    int resizeHeight=0;
    int resizeMode=0;
    int outputScale = 4;
    bool hasOutputScale = false;
    float compression = 0.00f;
    bool resizeProvided = false;
    bool hasCustomWidth = false;
    std::vector<int> tilesize;
    path_t model = PATHSTR("models");
    path_t modelname = PATHSTR("realesrgan-x4plus");
    std::vector<int> gpuid;
    int jobs_load = 1;
    std::vector<int> jobs_proc;
    int jobs_save = 2;
    int verbose = 0;
    int tta_mode = 0;
    path_t format = PATHSTR("png");

#if _WIN32
    setlocale(LC_ALL, "");
    wchar_t opt;
    while ((opt = getopt(argc, argv, L"i:o:z:a:s:r:w:t:c:m:n:g:j:f:F:Q:L:N:D:Z:A:P:vxh")) != (wchar_t)-1)
    {
        switch (opt)
        {
        case L'F': precision_flags=_wtoi(optarg);break;
        case L'N': second_model=optarg;break;
        case L'D': second_directory=optarg;break;
        case L'Z': second_scale=_wtoi(optarg);break;
        case L'A': second_alignment=_wtoi(optarg);break;
        case L'P': two_manifest=optarg;break;
        case L'Q': controlpath = optarg; break;
        case L'L': manifestpath = optarg; break;
        case L'i':
            inputpath = optarg;
            break;
        case L'o':
            outputpath = optarg;
            break;
        case L'a': input_multiple=_wtoi(optarg);break;
        case L'z':
            native_scale_provided=true;scale = _wtoi(optarg);
            break;
        case L's':
            outputScale = _wtoi(optarg);
            hasOutputScale = true;
            break;
        case L'c':
            compression = _wtof(optarg);
            if (compression < 0 || compression > 100)
            {
                fwprintf(stderr, L"🚨 Error: Invalid compression value, it should be between 0 and 100!\n");
                return -1;
            }
            compression = round(compression / 10.0) * 10;
            break;
        case L'r':
            if (wcscmp(optarg, L"help") == 0)
            {
                print_resize_usage();
                return -1;
            }
            if (!parse_optarg_resize(optarg, &resizeWidth, &resizeHeight, &resizeMode))
            {
                fwprintf(stderr, L"🚨 Error: Invalid resize value!\n");
                return -1;
            }
            resizeProvided = true;
            break;
        case L'w':
            if (wcscmp(optarg, L"help") == 0)
            {
                print_resize_usage();
                return -1;
            }
            if (!parse_optarg_resize(optarg, &resizeWidth, &resizeHeight, &resizeMode, true))
            {
                fwprintf(stderr, L"🚨 Error: Invalid resize value!\n");
                return -1;
            }
            hasCustomWidth = true;
            break;
        case L't':
            tilesize = parse_optarg_int_array(optarg);
            break;
        case L'm':
            model = optarg;
            break;
        case L'n':
            modelname = optarg;
            break;
        case L'g':
            gpuid = parse_optarg_int_array(optarg);
            break;
        case L'j':
            swscanf(optarg, L"%d:%*[^:]:%d", &jobs_load, &jobs_save);
            jobs_proc = parse_optarg_int_array(wcschr(optarg, L':') + 1);
            break;
        case L'f':
            format = optarg;
            break;
        case L'v':
            verbose = 1;
            break;
        case L'x':
            tta_mode = 1;
            break;
        case L'h':
        default:
            print_usage();
            return -1;
        }
    }
#else  // _WIN32
    int opt;
    fprintf(stderr, "🚀 Starting Upscayl - Copyright © 2024\n");
    while ((opt = getopt(argc, argv, "i:o:z:a:s:r:w:t:c:m:n:g:j:f:F:Q:L:N:D:Z:A:P:vxh")) != -1)
    {
        switch (opt)
        {
        case 'F': precision_flags=atoi(optarg);break;
        case 'N': second_model=optarg;break;
        case 'D': second_directory=optarg;break;
        case 'Z': second_scale=atoi(optarg);break;
        case 'A': second_alignment=atoi(optarg);break;
        case 'P': two_manifest=optarg;break;
        case 'Q': controlpath = optarg; break;
        case 'L': manifestpath = optarg; break;
        case 'i':
            inputpath = optarg;
            break;
        case 'o':
            outputpath = optarg;
            break;
        case 'a': input_multiple=atoi(optarg);break;
        case 'z':
            native_scale_provided=true;scale = atoi(optarg);
            break;
        case 's':
            outputScale = atoi(optarg);
            hasOutputScale = true;
            break;
        case 'c':
            compression = atof(optarg);
            if (compression < 0 || compression > 100)
            {
                fprintf(stderr, "🚨 Error: Invalid compression value, it should be between 0 and 100!\n");
                return -1;
            }
            compression = round(compression / 10.0) * 10;
            break;
        case 'r':
            if (strcmp(optarg, "help") == 0)
            {
                print_resize_usage();
                return -1;
            }
            if (!parse_optarg_resize(optarg, &resizeWidth, &resizeHeight, &resizeMode))
            {
                fprintf(stderr, "🚨 Error: Invalid resize value!\n");
                return -1;
            }
            resizeProvided = true;
            break;
        case 'w':
            if (strcmp(optarg, "help") == 0)
            {
                print_resize_usage();
                return -1;
            }
            if (!parse_optarg_resize(optarg, &resizeWidth, &resizeHeight, &resizeMode, true))
            {
                fprintf(stderr, "🚨 Error: Invalid resize value!\n");
                return -1;
            }
            hasCustomWidth = true;
            break;
        case 't':
            tilesize = parse_optarg_int_array(optarg);
            break;
        case 'm':
            model = optarg;
            break;
        case 'n':
            modelname = optarg;
            break;
        case 'g':
            gpuid = parse_optarg_int_array(optarg);
            break;
        case 'j':
            sscanf(optarg, "%d:%*[^:]:%d", &jobs_load, &jobs_save);
            jobs_proc = parse_optarg_int_array(strchr(optarg, ':') + 1);
            break;
        case 'f':
            format = optarg;
            break;
        case 'v':
            verbose = 1;
            break;
        case 'x':
            tta_mode = 1;
            break;
        case 'h':
        default:
            print_usage();
            return -1;
        }
    }
#endif // _WIN32
    if (inputpath.empty() || outputpath.empty())
    {
        print_usage();
        return -1;
    }

    if (tilesize.size() != (gpuid.empty() ? 1 : gpuid.size()) && !tilesize.empty())
    {
        fprintf(stderr, "🚨 Error: Invalid tile size!\n");
        return -1;
    }

    for (int i = 0; i < (int)tilesize.size(); i++)
    {
        if (tilesize[i] != 0 && tilesize[i] < 32)
        {
            fprintf(stderr, "🚨 Error: Invalid tile size!\n");
            return -1;
        }
    }

    if (jobs_load < 1 || jobs_save < 1)
    {
        fprintf(stderr, "🚨 Error: Invalid thread count!\n");
        return -1;
    }

    if (jobs_proc.size() != (gpuid.empty() ? 1 : gpuid.size()) && !jobs_proc.empty())
    {
        fprintf(stderr, "🚨 Error: invalid jobs_proc thread count!\n");
        return -1;
    }

    for (int i = 0; i < (int)jobs_proc.size(); i++)
    {
        if (jobs_proc[i] < 1)
        {
            fprintf(stderr, "🚨 Error: Invalid jobs_proc thread count argument!\n");
            return -1;
        }
    }

    if (!path_is_directory(outputpath))
    {
        path_t ext = format;

        if (ext == PATHSTR("png") || ext == PATHSTR("PNG"))
        {
            format = PATHSTR("png");
        }
        else if (ext == PATHSTR("webp") || ext == PATHSTR("WEBP"))
        {
            format = PATHSTR("webp");
        }
        else if (ext == PATHSTR("jpg") || ext == PATHSTR("JPG") || ext == PATHSTR("jpeg") || ext == PATHSTR("JPEG"))
        {
            format = PATHSTR("jpg");
        }
        else
        {
            fprintf(stderr, "🚨 Error: Invalid output path extension or type!\n");
            return -1;
        }
    }

    if (format != PATHSTR("png") && format != PATHSTR("webp") && format != PATHSTR("jpg"))
    {
        fprintf(stderr, "🚨 Error: Invalid format provided!\n");
        return -1;
    }

    // collect input and output filepath
    std::vector<path_t> input_files;
    std::vector<path_t> output_files;
    {
        if (path_is_directory(inputpath) && path_is_directory(outputpath))
        {
            std::vector<path_t> filenames;
            int lr = list_directory(inputpath, filenames);
            if (lr != 0)
                return -1;

            const int count = filenames.size();
            input_files.resize(count);
            output_files.resize(count);

            path_t last_filename;
            path_t last_filename_noext;
            for (int i = 0; i < count; i++)
            {
                path_t filename = filenames[i];
                path_t filename_noext = get_file_name_without_extension(filename);
                path_t output_filename = filename_noext + PATHSTR('.') + format;

                // filename list is sorted, check if output image path conflicts
                if (filename_noext == last_filename_noext)
                {
                    path_t output_filename2 = filename + PATHSTR('.') + format;
#if _WIN32
                    fwprintf(stderr, L"⚠️ Warning: both %s and %s output %s! %s will output %s\n", filename.c_str(), last_filename.c_str(), output_filename.c_str(), filename.c_str(), output_filename2.c_str());
#else
                    fprintf(stderr, "⚠️ Warning: both %s and %s output %s! %s will output %s\n", filename.c_str(), last_filename.c_str(), output_filename.c_str(), filename.c_str(), output_filename2.c_str());
#endif
                    output_filename = output_filename2;
                }
                else
                {
                    last_filename = filename;
                    last_filename_noext = filename_noext;
                }

                input_files[i] = inputpath + PATHSTR('/') + filename;
                output_files[i] = outputpath + PATHSTR('/') + output_filename;
            }
        }
        else if (!path_is_directory(inputpath) && !path_is_directory(outputpath))
        {
            input_files.push_back(inputpath);
            output_files.push_back(outputpath);
        }
        else
        {
            fprintf(stderr, "🚨 Error: Input path and Output path both must be either a file or a directory!\n");
            return -1;
        }
    }

    if (!manifestpath.empty()) {
        if(controlpath.empty()) return -1;
        {
            jm::control = fs::path(controlpath);
            auto paths = jm::manifest(fs::path(manifestpath));
            if(paths.empty()) { fprintf(stderr, "Invalid session manifest\n"); return -1; }
            input_files.clear(); output_files.clear();
            for(const auto& item : paths) {
#if _WIN32
                input_files.push_back(item.input.wstring()); output_files.push_back(item.output.wstring());
#else
                input_files.push_back(item.input.string()); output_files.push_back(item.output.string());
#endif
            }
        }
    }

    jm::Monitor monitor;
    if(input_multiple!=1&&input_multiple!=2&&input_multiple!=4){fprintf(stderr,"Invalid model input alignment\n");return -1;}
    // Pixel-unshuffle models must preserve the original global pixel phase.
    const int prepadding=((10+input_multiple-1)/input_multiple)*input_multiple;

    // if (modelname.find(PATHSTR("realesrgan-x4plus")) != path_t::npos
    //     || modelname.find(PATHSTR("realesrnet-x4plus")) != path_t::npos
    //     || modelname.find(PATHSTR("esrgan-x4")) != path_t::npos)
    // {}
    // else
    // {
    //     fprintf(stderr, "unknown model name\n");
    //     return -1;
    // }

    // Application metadata is authoritative; filename inference remains only
    // for legacy custom CLI models which did not supply -z.
    if(!native_scale_provided){
        if(modelname.find(PATHSTR("16x"))!=path_t::npos||modelname.find(PATHSTR("x16"))!=path_t::npos)scale=16;
        else if(modelname.find(PATHSTR("1x"))!=path_t::npos||modelname.find(PATHSTR("x1"))!=path_t::npos)scale=1;
        else if(modelname.find(PATHSTR("2x"))!=path_t::npos||modelname.find(PATHSTR("x2"))!=path_t::npos)scale=2;
        else if(modelname.find(PATHSTR("3x"))!=path_t::npos||modelname.find(PATHSTR("x3"))!=path_t::npos)scale=3;
        else if(modelname.find(PATHSTR("4x"))!=path_t::npos||modelname.find(PATHSTR("x4"))!=path_t::npos)scale=4;
        else if(modelname.find(PATHSTR("8x"))!=path_t::npos||modelname.find(PATHSTR("x8"))!=path_t::npos)scale=8;
    }
    path_t stem=modelname;
    if(modelname==PATHSTR("realesr-animevideov3")){
#if _WIN32
        stem+=PATHSTR("-x")+std::to_wstring(scale);
#else
        stem+=PATHSTR("-x")+std::to_string(scale);
#endif
    }
    path_t paramfullpath=sanitize_filepath((fs::path(model)/(stem+PATHSTR(".param"))).native());
    path_t modelfullpath=sanitize_filepath((fs::path(model)/(stem+PATHSTR(".bin"))).native());


#if _WIN32
    CoInitializeEx(NULL, COINIT_MULTITHREADED);
#endif

    ncnn::create_gpu_instance();

    if (gpuid.empty())
    {
        gpuid.push_back(ncnn::get_default_gpu_index());
    }

    const int use_gpu_count = (int)gpuid.size();

    if (jobs_proc.empty())
    {
        jobs_proc.resize(use_gpu_count, 2);
    }

    if (tilesize.empty())
    {
        tilesize.resize(use_gpu_count, 0);
    }

    int cpu_count = std::max(1, ncnn::get_cpu_count());
    jobs_load = std::min(jobs_load, cpu_count);
    jobs_save = std::min(jobs_save, cpu_count);

    int gpu_count = ncnn::get_gpu_count();
    for (int i = 0; i < use_gpu_count; i++)
    {
        if (gpuid[i] < 0 || gpuid[i] >= gpu_count)
        {
            fprintf(stderr, "🚨 Error: Invalid GPU Device\n");

            ncnn::destroy_gpu_instance();
            return -1;
        }
    }

    int total_jobs_proc = 0;
    for (int i = 0; i < use_gpu_count; i++)
    {
        int gpu_queue_count = ncnn::get_gpu_info(gpuid[i]).compute_queue_count();
        jobs_proc[i] = std::min(jobs_proc[i], gpu_queue_count);
        total_jobs_proc += jobs_proc[i];
    }

    for (int i = 0; i < use_gpu_count; i++)
    {
        if (tilesize[i] != 0)
            continue;

        uint32_t heap_budget = ncnn::get_gpu_device(gpuid[i])->get_heap_budget();

        // more fine-grained tilesize policy here
        { // ESRGAN policy also applies to custom directories.
            if (heap_budget > 1900)
                tilesize[i] = 200;
            else if (heap_budget > 550)
                tilesize[i] = 100;
            else if (heap_budget > 190)
                tilesize[i] = 64;
            else
                tilesize[i] = 32;
        }
    }

    if(!second_model.empty()){
        if(use_gpu_count!=1||second_directory.empty()||two_manifest.empty()||(second_scale!=1&&second_scale!=2&&second_scale!=4)||(second_alignment!=1&&second_alignment!=2&&second_alignment!=4)){fprintf(stderr,"[two-stage] invalid model metadata or GPU selection\n");ncnn::destroy_gpu_instance();return 2;}
        SaveThreadParams stp{};stp.resizeWidth=resizeWidth;stp.resizeHeight=resizeHeight;stp.resizeMode=resizeMode;stp.resizeProvided=resizeProvided;stp.verbose=verbose;stp.compression=compression;stp.outputScale=outputScale;stp.hasOutputScale=hasOutputScale;stp.hasCustomWidth=hasCustomWidth;
        int result=jm5::worker(two_manifest,model,stem,second_directory,second_model,scale,second_scale,input_multiple,second_alignment,gpuid[0],tilesize[0],tta_mode,precision_flags,stp);
        ncnn::destroy_gpu_instance();return result;
    }

    {
        std::vector<RealESRGAN *> realesrgan(use_gpu_count);

        for (int i = 0; i < use_gpu_count; i++)
        {
            realesrgan[i] = new RealESRGAN(gpuid[i], tta_mode, (precision_flags&1)!=0);

            if(realesrgan[i]->load(paramfullpath, modelfullpath) != 0) return -1;

            realesrgan[i]->scale = scale;
            realesrgan[i]->tilesize = tilesize[i]/input_multiple*input_multiple;
            realesrgan[i]->prepadding = prepadding;
            realesrgan[i]->input_multiple = input_multiple;
        }

        // main routine
        {
            // load image
            LoadThreadParams ltp;
            ltp.scale = scale;
            ltp.jobs_load = jobs_load;
            ltp.input_files = input_files;
            ltp.output_files = output_files;

            ncnn::Thread load_thread(load, (void *)&ltp);

            // realesrgan proc
            std::vector<ProcThreadParams> ptp(use_gpu_count);
            for (int i = 0; i < use_gpu_count; i++)
            {
                ptp[i].realesrgan = realesrgan[i];
            }

            std::vector<ncnn::Thread *> proc_threads(total_jobs_proc);
            {
                int total_jobs_proc_id = 0;
                for (int i = 0; i < use_gpu_count; i++)
                {
                    for (int j = 0; j < jobs_proc[i]; j++)
                    {
                        proc_threads[total_jobs_proc_id++] = new ncnn::Thread(proc, (void *)&ptp[i]);
                    }
                }
            }

            // save image
            SaveThreadParams stp;
            stp.resizeWidth = resizeWidth;
            stp.resizeHeight = resizeHeight;
            stp.resizeMode = resizeMode;
            stp.resizeProvided = resizeProvided;
            stp.verbose = verbose;
            stp.compression = compression;
            stp.outputScale = outputScale;
            stp.hasOutputScale = hasOutputScale;
            stp.hasCustomWidth = hasCustomWidth;

            std::vector<ncnn::Thread *> save_threads(jobs_save);
            for (int i = 0; i < jobs_save; i++)
            {
                save_threads[i] = new ncnn::Thread(save, (void *)&stp);
            }

            // end
            load_thread.join();

            Task end;
            end.id = -233;

            for (int i = 0; i < total_jobs_proc; i++)
            {
                toproc.put(end);
            }

            for (int i = 0; i < total_jobs_proc; i++)
            {
                proc_threads[i]->join();
                delete proc_threads[i];
            }

            for (int i = 0; i < jobs_save; i++)
            {
                tosave.put(end);
            }

            for (int i = 0; i < jobs_save; i++)
            {
                save_threads[i]->join();
                delete save_threads[i];
            }
        }

        for (int i = 0; i < use_gpu_count; i++)
        {
            delete realesrgan[i];
        }
        realesrgan.clear();
    }

    ncnn::destroy_gpu_instance();

    return jm::failed ? 2 : 0;
}
