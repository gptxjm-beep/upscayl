# Optional, verified original models

Weights are **not bundled** with the app. The reviewed versions use
CC-BY-NC-SA-4.0 (noncommercial, attribution, ShareAlike), rather than the license
currently displayed on the author's default branch. See the complete license in
this directory and the exact sources/hashes in `common/optional-models.json`.
Original author: the-database (MangaJaNai / IllustrationJaNai), null-llun (Manhwa Null).
Conversion changes: Spandrel ESRGAN wrapper exported without shape-dependent
padding/crop, input/output names normalized, NCNN 20240410 optimization with FP16
weights. Native input alignment is declared separately from output scale. MangaJaNai uses an explicit FP32 activation path: an aggressive tiny synthetic pattern exceeded the FP16 reference tolerance. The default Upscayl and Illustration precision paths remain unchanged. Its GPU memory and speed impact requires measurement on real hardware.

## Windows 11 preparation

Use Python 3.11, create a virtual environment, then install:

```powershell
py -3.11 -m venv .model-venv
.model-venv\Scripts\Activate.ps1
python -m pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r tools/models/requirements.txt
```

Download original `.pth` weights from the **1.0.0** author release:
https://github.com/the-database/MangaJaNai/releases/tag/1.0.0

- IllustrationJaNai: `4x_IllustrationJaNai_V1_ESRGAN_135k.pth` from the Illustration archive.
- MangaJaNai: `2x_MangaJaNai_1600p_V1_ESRGAN_90k.pth` from the Manga archive.
- Manhwa Null: follow the original download link at
  https://openmodeldb.info/models/1x-Manhwa-Null . The verified user-provided original is also stored in `vendor/optional-model-sources/Manhwa-Null`, together with its source/attribution and separate CC-BY-NC-SA license. It has native scale 1X with PixelUnshuffle4 input alignment, padding12 and aligned tile origins. Do not substitute an unrelated weight or rename another model to Manhwa Null.

Download `ncnnoptimize.exe` from the official **20240410** Windows tools release:
https://github.com/Tencent/ncnn/releases/tag/20240410

Build the enhanced engine normally (`python tools/build-enhanced-engine.py`) or
use its exact executable from the verified Windows package. Review the license
before explicitly acknowledging it:

```powershell
python tools/models/prepare.py --id 2x-mangajanai-1600p-v1-esrgan `
  --weights C:\Models\2x_MangaJaNai_1600p_V1_ESRGAN_90k.pth `
  --optimizer C:\NCNN\ncnnoptimize.exe `
  --engine "C:\Apps\Upscayl Enhanced\resources\bin\upscayl-jm.exe" `
  --destination C:\Models\UpscaylVerified --gpu 0 `
  --accept-noncommercial-sharealike-license
```

Repeat for Illustration with its catalog ID/weight. Select this destination via
Settings > Custom Models. A curated model is hidden until a matching verified
manifest exists; a changed `.param` or `.bin` invalidates it. Existing custom
models keep their original discovery behavior. Existing destination files are
never overwritten. Evidence is saved in `<id>.validation`; share its logs, PNGs,
and the model manifest, **not the original weights**, to review compatibility.

The import tool uses `weights_only=True`, checks the original SHA-256 before
loading, checks ESRGAN/RGB/native scale/alignment, compares actual native Vulkan
inference against PyTorch on five synthetic cases (32×32, odd dimensions, tiles,
tiny border, TTA), plus a narrow 12×601 aligned-tile case for Manhwa, and activates the manifest only after all comparisons pass.
Thresholds: PSNR >= 40 dB, mean absolute error <= 2, max absolute error <= 24
(8-bit channels). This proves the listed functional cases; it does not prove
visual quality on real pages, all drivers, alpha handling, or GPU performance.

MangaJaNai's 1200p–2048p variants target different source page heights. 1600p is a
starting point for pages near that height; compare crops at original source
resolution against 1200/1300/1400/1500/1920/2048 variants before a quality
recommendation. A 30,000-pixel tall stitched page is not automatically a 1600p
training sample. Other variants require their own hash and compatibility review;
they are not silently substituted by this import tool.
