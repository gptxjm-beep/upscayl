# Upscayl Enhanced JM6 — work in progress

Branch: `feature/jm6-models-color-recovery`, based on verified JM5 `7f0fbb74119c265854f243cf9929c63aa2217bd1`. Stable JM5 Windows acceptance: https://github.com/gptxjm-beep/upscayl/actions/runs/42980218956 . No main merge or official release.

## Decisions and validation limits

The user approved ONNX Runtime with DirectML for new architectures; existing NCNN models retain their existing route. Routine compatible engineering decisions are authorized. Destructive data operations, licensing/security blockers and tests above 100 images still require a separate decision. Default stability coverage is 50 images. Model checks use 3–5 varied images, selected ordered pairs use 5–10, and existing model references are reused when unaffected. The old 1000-image automatic cases were reduced to 50; the native suite rejects counts other than 50/100. No 1000-image JM6 run has been performed.

## Recovery diagnosis and fix

`discover()` previously treated missing/corrupt pointers or journals as generic processing warnings. The duplicate-warning set lived only in memory, so a damaged pointer generated the warning again on each app launch. There was no durable user action for acknowledging an unreadable record. Separately, `atomicJSON()` copied an existing primary over `.bak` without checking its envelope/schema; a torn primary could destroy the only valid backup during the next save after recovery.

The reader now supports schema-aware fallback. Saving a session only rotates a valid primary into the backup. Discovery returns structured missing/unreadable notices rather than a processing error. An explicit Archive reminder action records a fingerprint-bound acknowledgement and copies available pointer/journal versions into an audit archive. It leaves all original journals, intermediate files and output images in place. Not Now is nondestructive; a repaired record becomes discoverable again. The application does not infer why a particular user's bytes became unreadable without those files/logs.

Verified locally: 40 session/recovery tests passed, production renderer/schema/TypeScript build passed, and real Electron startup → archive → close → reopen passed with the original malformed pointer unchanged. No GPU was used. Later integration evidence is listed below.

## Sources and current executor restriction

The six requested models remain tracked in [model-source-audit.json](jm6/model-source-audit.json), including blocked models. Archives and original weights are checked against release digests where published. PyTorch files use `weights_only=True`; FDAT originals are safetensors. Source cache: `/workspace/.model-sources/jm6`.

The user added Hugging Face domains to reusable environment settings. Fresh checks on this task still report observed revision 1, an enforced host list without HF, and CONNECT 403 for both official model APIs. This task cannot apply the new environment configuration. Resume download checks in a task attached to the updated saved/published environment; confirm the observed revision and host readiness before testing redirects and file hashes. No proxy bypass or unknown mirrors are used. UltraSharpV2 and AdaptivePhotoNet are not installed or tested.

## Integrated available-model path

ONNX Runtime Node 1.31.1 is exact-pinned. An isolated worker implements the existing image admission/ACK protocol and capacity one. Production Windows selects DirectML explicitly; tests use CPU and label it. NCNN-only jobs retain the existing engine and algorithm. The unchanged native source/build fingerprints and the previous verified portable/engine SHA-256 are checked before reusing the JM5 Windows engine. The new worker is compiled by TypeScript and included in the app archive. Its complete application logic is self-contained and hash-bound to the session; model file identities and processing metadata/provider are also checked on resume.

A single ONNX model stays resident across a single-model batch. Model changes release the previous session. Mixed NCNN/ONNX stages currently launch a native process per native stage; two ONNX models reload on each stage switch. This may reduce throughput versus the old continuous NCNN path, and must be measured on real hardware. No speed or VRAM claim is made.

FDAT graphs are promoted from the author's BF16 graph to FP32 and compared with the original BF16 safetensors loaded into the reviewed author architecture. Alchemy is RealPLKSR, not ESRGAN: tracing originally froze a DySample spatial normalizer; the export now derives it from dynamic shape while the independent reference retains the untouched PyTorch model. All three images, including odd dimensions and tile boundaries, pass with maximum pixel error 1. Adaptive 3D LUT uses the exact original paired sRGB predictor and three LUT bases, one global image analysis, the original trilinear binsize/axis order, actual strength/style blending and explicit neutral/white protection. Strength zero is identity. It is not an invented substitute for AdaptivePhotoNet.

New ONNX manifests require original source identity, model version, license acknowledgement, 3–5 passed actual inference comparisons, and every inference/license/attribution file's hash. Arbitrary ONNX or incomplete NCNN files are not listed. Folder selection accepts any folder name containing valid imports; cancelled/invalid selection preserves the old path. The model package has one top-level `models` directory and includes only validated inference files/notices. The two blocked models remain in the requirements/audit, never selectable as if supported.

Upscaler→color resizes to final dimensions before applying dimension-preserving color. Color alone defaults to 1X. Intermediate reduction before a second upscaler is explicit and off by default; it changes results and avoids a full 16X working image. The old unsafe-dimension guards remain. Alpha, tiled TTA, global image color, bounded strip composition, memory admission and durable adoption use targeted tests. Failed images release their slot; repeated inference/system errors stop the job. Pause releases the process after durable current work; a saved first-stage checkpoint resumes directly in stage two. Abrupt controller exit is tested before its ACK, not simulated by claiming a clean shutdown is a crash.

## Current evidence and outstanding work

- Four new available models: 3 original-weight reference images each; actual CPU inference and full image decode/dimensions. These are small varied derivatives of bundled comparison assets, not a real-page quality benchmark. LUT additionally processes a narrow 12×70,200 PNG.
- Three selected ordered pairs: 5 images each, including the existing NCNN→color bridge; capacity one and stage order verified. Two ONNX pairs also match independently executed ordered stages numerically.
- ONNX stability: 50 real color images with corrupt image 25 skipped; repair retries only that image. Stage-one/second failures, memory stop, pause, completed-output timestamps and abrupt controller exit covered.
- Existing NCNN two-stage suite: 19 tests passed, including the 50-image corrupt-image batch and checkpoint/crash recovery. No automatic test exceeds 100 images.
- Real Electron controls: Settings, original center card, STOP/PAUSE/RESUME, recovery archive/restart, custom model folder cancel/invalid/persistence, color controls and fixed picker height passed. Linux Electron uses an external Node image-validation workaround only in the existing test harness; packaged Windows must use real main IPC.
- Windows workflow is a **preview** because UltraSharpV2 and AdaptivePhotoNet are unavailable. It verifies original-weight inference on Windows CPU, regressions, clean extraction/import, all seven available optional models, a selected pair, restart, packaged drag/drop, long PNG preview, Installer/ZIP contents, ONNX/DML PE x64 files and SHA-256 before uploading delivery artifacts. A configured workflow is not a successful run: inspect the latest run before delivery.
- Real RTX 3060 Ti inference, DirectML operator coverage/performance/VRAM, representative full-resolution manga/manhwa quality, Explorer/external-viewer long PNG and power-loss disk durability remain practical acceptance items. CPU/software Vulkan acceptance cannot establish these.

See [the Arabic continuation report](jm6/progress-ar.md) and [per-model source/validation evidence](jm6/model-source-audit.json). Original model inputs remain cached at `/workspace/.model-sources/jm6`; generated models/evidence are under `.test-artifacts/jm6`, outside Git. User-owned `renderer/next-env.d.ts` and `tools/benchmark` are excluded from JM6 commits.
