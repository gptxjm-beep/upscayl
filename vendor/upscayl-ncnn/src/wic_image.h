#ifndef WIC_IMAGE_H
#define WIC_IMAGE_H

// image decoder and encoder with WIC
#include <wincodec.h>
#include <cstdio>

// COM is initialized per calling thread, including OpenMP load and save workers.
struct JmWicApartment {
    HRESULT status;
    JmWicApartment() : status(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
    ~JmWicApartment() { if(SUCCEEDED(status)) CoUninitialize(); }
    bool ready() const { return SUCCEEDED(status) || status == RPC_E_CHANGED_MODE; }
};
#define JM_WIC_CHECK(expression) do { HRESULT jm_hr = (expression); if(FAILED(jm_hr)) { fprintf(stderr, "[WIC] %s HRESULT=0x%08lx\n", #expression, static_cast<unsigned long>(jm_hr)); goto RETURN; } } while(0)

unsigned char *wic_decode_image(const wchar_t *filepath, int *w, int *h, int *c)
{
    JmWicApartment apartment;
    if(!apartment.ready()) { fprintf(stderr, "[WIC] CoInitializeEx HRESULT=0x%08lx\n", static_cast<unsigned long>(apartment.status)); return nullptr; }
    IWICImagingFactory *factory = 0;
    IWICBitmapDecoder *decoder = 0;
    IWICBitmapFrameDecode *frame = 0;
    WICPixelFormatGUID pixel_format;
    IWICPalette *palette = 0;
    BOOL global_palette_has_alpha = FALSE;
    BOOL frame_palette_has_alpha = FALSE;
    IWICFormatConverter *converter = 0;
    IWICBitmap *bitmap = 0;
    IWICBitmapLock *lock = 0;
    int width = 0;
    int height = 0;
    int channels = 0;
    WICRect rect = {0, 0, 0, 0};
    unsigned int datasize = 0;
    unsigned char *data = 0;
    int stride = 0;
    unsigned char *bgrdata = 0;

    JM_WIC_CHECK(CoCreateInstance(CLSID_WICImagingFactory1, 0, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));

    JM_WIC_CHECK(factory->CreateDecoderFromFilename(filepath, 0, GENERIC_READ, WICDecodeMetadataCacheOnDemand, &decoder));

    JM_WIC_CHECK(factory->CreatePalette(&palette));

    if (decoder->CopyPalette(palette) == S_OK)
    {
        if (palette->HasAlpha(&global_palette_has_alpha))
            goto RETURN;
    }

    JM_WIC_CHECK(decoder->GetFrame(0, &frame));

    if (frame->CopyPalette(palette) == S_OK)
    {
        if (palette->HasAlpha(&frame_palette_has_alpha))
            goto RETURN;
    }

    JM_WIC_CHECK(factory->CreateFormatConverter(&converter));

    JM_WIC_CHECK(frame->GetPixelFormat(&pixel_format));

    if (!IsEqualGUID(pixel_format, GUID_WICPixelFormat32bppBGRA))
        pixel_format = GUID_WICPixelFormat24bppBGR;

    if (global_palette_has_alpha || frame_palette_has_alpha)
        pixel_format = GUID_WICPixelFormat32bppBGRA;

    channels = IsEqualGUID(pixel_format, GUID_WICPixelFormat32bppBGRA) ? 4 : 3;

    JM_WIC_CHECK(converter->Initialize(frame, pixel_format, WICBitmapDitherTypeNone, 0, 0.0, WICBitmapPaletteTypeCustom));

    JM_WIC_CHECK(factory->CreateBitmapFromSource(converter, WICBitmapCacheOnDemand, &bitmap));

    JM_WIC_CHECK(bitmap->GetSize((UINT *)&width, (UINT *)&height));

    rect.Width = width;
    rect.Height = height;
    JM_WIC_CHECK(bitmap->Lock(&rect, WICBitmapLockRead, &lock));

    JM_WIC_CHECK(lock->GetDataPointer(&datasize, &data));

    JM_WIC_CHECK(lock->GetStride((UINT *)&stride));

    bgrdata = (unsigned char *)malloc(width * height * channels);
    if (!bgrdata)
        goto RETURN;

    for (int y = 0; y < height; y++)
    {
        const unsigned char *ptr = data + y * stride;
        unsigned char *bgrptr = bgrdata + y * width * channels;
        memcpy(bgrptr, ptr, width * channels);
    }

    *w = width;
    *h = height;
    *c = channels;

RETURN:
    if (lock)
        lock->Release();
    if (bitmap)
        bitmap->Release();
    if (decoder)
        decoder->Release();
    if (frame)
        frame->Release();
    if (palette)
        palette->Release();
    if (converter)
        converter->Release();
    if (factory)
        factory->Release();

    return bgrdata;
}

int wic_encode_image(const wchar_t *filepath, int w, int h, int c, void *bgrdata)
{
    JmWicApartment apartment;
    if(!apartment.ready()) { fprintf(stderr, "[WIC] CoInitializeEx HRESULT=0x%08lx\n", static_cast<unsigned long>(apartment.status)); return 0; }
    IWICImagingFactory *factory = 0;
    IWICStream *stream = 0;
    IWICBitmapEncoder *encoder = 0;
    IWICBitmapFrameEncode *frame = 0;
    WICPixelFormatGUID format = c == 4 ? GUID_WICPixelFormat32bppBGRA : GUID_WICPixelFormat24bppBGR;
    int stride = (w * c * 8 + 7) / 8;
    unsigned char *data = 0;
    int ret = 0;

    JM_WIC_CHECK(CoCreateInstance(CLSID_WICImagingFactory1, 0, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));

    JM_WIC_CHECK(factory->CreateStream(&stream));

    JM_WIC_CHECK(stream->InitializeFromFilename(filepath, GENERIC_WRITE));

    JM_WIC_CHECK(factory->CreateEncoder(GUID_ContainerFormatPng, 0, &encoder));

    JM_WIC_CHECK(encoder->Initialize(stream, WICBitmapEncoderNoCache));

    JM_WIC_CHECK(encoder->CreateNewFrame(&frame, 0));

    JM_WIC_CHECK(frame->Initialize(0));

    JM_WIC_CHECK(frame->SetSize((UINT)w, (UINT)h));

    JM_WIC_CHECK(frame->SetPixelFormat(&format));

    if (!IsEqualGUID(format, c == 4 ? GUID_WICPixelFormat32bppBGRA : GUID_WICPixelFormat24bppBGR))
        goto RETURN;

    data = (unsigned char *)malloc(h * stride);
    if (!data)
        goto RETURN;

    for (int y = 0; y < h; y++)
    {
        const unsigned char *bgrptr = (const unsigned char *)bgrdata + y * w * c;
        unsigned char *ptr = data + y * stride;
        memcpy(ptr, bgrptr, w * c);
    }

    JM_WIC_CHECK(frame->WritePixels(h, stride, h * stride, data));

    JM_WIC_CHECK(frame->Commit());

    JM_WIC_CHECK(encoder->Commit());

    ret = 1;

RETURN:
    if (data)
        free(data);
    if (encoder)
        encoder->Release();
    if (frame)
        frame->Release();
    if (stream)
        stream->Release();
    if (factory)
        factory->Release();

    return ret;
}

int wic_encode_jpeg_image(const wchar_t *filepath, int w, int h, int c, void *bgrdata)
{
    JmWicApartment apartment;
    if(!apartment.ready()) { fprintf(stderr, "[WIC] CoInitializeEx HRESULT=0x%08lx\n", static_cast<unsigned long>(apartment.status)); return 0; }
    // assert c == 3

    IWICImagingFactory *factory = 0;
    IWICStream *stream = 0;
    IWICBitmapEncoder *encoder = 0;
    IWICBitmapFrameEncode *frame = 0;
    IPropertyBag2 *propertybag = 0;
    WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
    int stride = (w * c * 8 + 7) / 8;
    unsigned char *data = 0;
    int ret = 0;

    PROPBAG2 option = {0};
    option.pstrName = L"ImageQuality";
    VARIANT varValue;
    VariantInit(&varValue);
    varValue.vt = VT_R4;
    varValue.fltVal = 1.0f;

    JM_WIC_CHECK(CoCreateInstance(CLSID_WICImagingFactory1, 0, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));

    JM_WIC_CHECK(factory->CreateStream(&stream));

    JM_WIC_CHECK(stream->InitializeFromFilename(filepath, GENERIC_WRITE));

    JM_WIC_CHECK(factory->CreateEncoder(GUID_ContainerFormatJpeg, 0, &encoder));

    JM_WIC_CHECK(encoder->Initialize(stream, WICBitmapEncoderNoCache));

    JM_WIC_CHECK(encoder->CreateNewFrame(&frame, &propertybag));

    JM_WIC_CHECK(propertybag->Write(1, &option, &varValue));

    JM_WIC_CHECK(frame->Initialize(propertybag));

    JM_WIC_CHECK(frame->SetSize((UINT)w, (UINT)h));

    JM_WIC_CHECK(frame->SetPixelFormat(&format));

    if (!IsEqualGUID(format, GUID_WICPixelFormat24bppBGR))
        goto RETURN;

    data = (unsigned char *)malloc(h * stride);
    if (!data)
        goto RETURN;

    for (int y = 0; y < h; y++)
    {
        const unsigned char *bgrptr = (const unsigned char *)bgrdata + y * w * c;
        unsigned char *ptr = data + y * stride;
        memcpy(ptr, bgrptr, w * c);
    }

    JM_WIC_CHECK(frame->WritePixels(h, stride, h * stride, data));

    JM_WIC_CHECK(frame->Commit());

    JM_WIC_CHECK(encoder->Commit());

    ret = 1;

RETURN:
    if (data)
        free(data);
    if (encoder)
        encoder->Release();
    if (frame)
        frame->Release();
    if (propertybag)
        propertybag->Release();
    if (stream)
        stream->Release();
    if (factory)
        factory->Release();

    return ret;
}

#undef JM_WIC_CHECK
#endif // WIC_IMAGE_H
