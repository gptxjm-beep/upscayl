# JM6 Dev3 — lossless PNG storage fix

Target: Windows10 x64 **22H2**, RTX3060Ti8GB, i5-14400F, RAM16GB. Branch `fix/jm6-lossless-png-compression`, based on Dev2 plus its evidence-only commit53b551a. This task changes PNG storage only. **FDAT XL remains broken on the user's real DirectML GPU** (Dev2: Reshape/node_view_2,0x8007023E, including160×160). Windows recognizes the RTX and D3D12 device creation succeeds; root cause is unresolved. Preserve that case/profiling for a separate future task; no re-export, new weights, CUDA or DirectML changes in Dev3.

## Cause and settings

`renderer/atoms/user-settings-atom.ts` defaults the persisted `compression` setting to0. It is passed unchanged through the single/batch/two-model payloads to the worker. JPG/WebP interpret it as quality100−compression. The former ONNX `encode()` incorrectly used round(compression×.09) for PNG effort, so the normal highest-quality setting0 wrote effectively uncompressed PNG. For RGB1440×12240, raw pixels alone are52,876,800bytes; a level0 encoded control measures52,974,263bytes (50.52MiB), reproducing the reported pattern.

The user's original000558.jpg and actual historical session files are not attached here. Therefore the settings of those device sessions cannot be inspected directly. The default/payload route is verified from source, the observed size is reproduced on a controlled image with the same output dimensions, and new `png-encode` events record the actual persisted setting and effective level for subsequent jobs. Do not claim access to the user's old logs.

Final ONNX PNG now uses lossless zlib level **6…9**, adaptive PNG row filtering, explicit `palette:false`. Saved0 means level6, saved100 means level9 (round(6+3×compression/100)); all pixel channels/precision stay unchanged. Filtering is reversible storage prediction, not AI/image filtering. No quantization, palette conversion, dithering, resize, colour/alpha math, inference precision or model weights changed. No new preference key or migration: old saved values remain valid. JPG/WebP keep their exact previous encoding/quality interpretation and tested byte output.

All ONNX finals share this encoder: Alchemy, LUT-only, ONNX→ONNX and native→ONNX, as well as future verified models. ONNX→NCNN finals retain the already-compressed native encoder.

## Save-path audit

| Path | Policy |
|---|---|
| ONNX final neural image | Level6 minimum, adaptive filtering, no palette |
| LUT-only final / final LUT in a pair | Same final encoder, unchanged colour computation |
| First ONNX stage checkpoint | Explicit internal temporaryPNG:true, same level0 fast encoding as Dev2 |
| Tiles, row stripes, grouped stripes, native assembly, RGB scratch | Existing fast level0 unchanged; removed by existing finally cleanup |
| Alpha scratch | Existing lossless encoder unchanged |
| Native NCNN normal PNG on Windows | Existing WIC encoder, already compressed; unchanged |
| Native NCNN long PNG / WIC size fallback | Existing streaming libpng; default compression0 maps tolevel6; unchanged |
| Native Linux ordinary PNG | Existing stb compressed writer, default9; unchanged |
| Native-only single/batch/two-stage | Same exact binary/source; no inference or writer modification |

NCNN's historical positive slider handling differs from ONNX and Windows WIC does not map it like zlib levels. This patch deliberately leaves the working native paths untouched;0 does not produce raw native PNG. User-facing English/Arabic compression help is visible at0 and explains lossless PNG versus lossy JPG/WebP. Other locale descriptions remain their existing lossless explanation.

Final adoption still requires success, full decode, dimensions, safe fsync/link without overwrite, and durable journal/ACK. Stage order, one admitted image, checkpoints, Pause/Resume and recovery validation are unchanged. No post-adoption re-encoding or replacement of user outputs. Avoid updating the worker during an active old ONNX session: existing engine/model hash guards remain strict; resolve the old session in its original version first.

## Measured verification

`tests/jobs/png-compression.cjs` uses7 unique encoding inputs: bundled-colour illustration derivative, controlled text, RGB gradients, RGBA with hidden RGB/zero alpha,1440×12240 long illustration derivative, and two previously independently generated original-weight outputs (Alchemy48×388; LUT12×70200). These are not the user's manhwa page or a new model quality benchmark. Each is encoded with old0, new6 and new9: **all decoded pixels differ by0**, with equal dimensions, channels, decoded data type and alpha. Source SHA checks preserve inputs. Checkpoint PNG and JPG/WebP controls retain identical file bytes.

Results include bytes and encoding time for each variant; RSS is sampled every10ms in isolated encoding child processes (including start/end), so brief native peaks can be missed. Linux inherited pre-exec maximum RSS is not used. These are single encoding observations, not repeated inference-performance claims. Level9 does not guarantee smaller files for every content type; default6 avoids its disproportionate CPU cost.

The production change adds no full-image JS pixel buffer or postprocessing pass. PNG compression/filter buffers add native codec work and some memory. Existing raw/stripe limits and validation remain. Temporary uncompressed stripes/checkpoints may still consume disk proportional to native4X dimensions; changing their compression is deferred because it would add stage-time cost and require separate measurements. Temporary cleanup/recovery safety is preserved.

Local critical suite:32 passed,1 deliberately skipped50-image test,0 failed. Includes tiled long PNG height70200 with more than32 strips, alpha/TTA/deep Unicode paths, real native bridge on software Vulkan, both-stage failures, memory stop, pause, abrupt host recovery, safe output adoption and report integrity. No50/100/1000-image rerun or physical NVIDIA benchmark for this patch.

Windows CI reuses the **exact Dev2 seven-model ZIP** from run43163768372, with no model conversion/re-download from model authors. Previously generated reference PNGs come from the original successful JM6 diagnostics. Packaging tests execute only4 selected single models (Alchemy,LUT,IllustrationV1,Manhwa) and2 relevant ordered pairs (Alchemy→LUT,Manhwa→Alchemy), one image/job, CPU/software Vulkan. This verifies final save routes and model folder persistence. No FDAT inference/fix attempts are included.

Models download (unchanged): https://github.com/gptxjm-beep/upscayl/actions/runs/43163768372/artifacts/13919139335 . Existing Dev2 models can be used directly. UltraSharpV2 DAT2 and AdaptivePhotoNet6M remain future requirements, unchanged by this storage fix.
