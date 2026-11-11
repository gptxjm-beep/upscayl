# Upscayl Enhanced JM6 — work in progress

Branch: `feature/jm6-models-color-recovery`, based on verified JM5 `7f0fbb74119c265854f243cf9929c63aa2217bd1`. Stable JM5 Windows acceptance: https://github.com/gptxjm-beep/upscayl/actions/runs/42980218956 . No main merge or official release.

## Decisions and validation limits

The user approved ONNX Runtime with DirectML for new architectures; existing NCNN models retain their existing route. Routine compatible engineering decisions are authorized. Destructive data operations, licensing/security blockers and tests above 100 images still require a separate decision. Default stability coverage is 50 images. Model checks use 3–5 varied images, selected ordered pairs use 5–10, and existing model references are reused when unaffected. The old 1000-image automatic cases were reduced to 50; the native suite rejects counts other than 50/100. No 1000-image JM6 run has been performed.

## Recovery diagnosis and implemented first change

`discover()` previously treated missing/corrupt pointers or journals as generic processing warnings. The duplicate-warning set lived only in memory, so a damaged pointer generated the warning again on each app launch. There was no durable user action for acknowledging an unreadable record. Separately, `atomicJSON()` copied an existing primary over `.bak` without checking its envelope/schema; a torn primary could destroy the only valid backup during the next save after recovery.

The reader now supports schema-aware fallback. Saving a session only rotates a valid primary into the backup. Discovery returns structured missing/unreadable notices rather than a processing error. An explicit Archive reminder action records a fingerprint-bound acknowledgement and copies available pointer/journal versions into an audit archive. It leaves all original journals, intermediate files and output images in place. Not Now is nondestructive; a repaired record becomes discoverable again. The application does not infer why a particular user's bytes became unreadable without those files/logs.

Verified locally: 40 session/recovery tests passed, production renderer/schema/TypeScript build passed, and real Electron startup → archive → close → reopen passed with the original malformed pointer unchanged. No GPU was used. Remaining JM6 integration changes require further targeted validation.

## Sources and current executor restriction

The six requested models remain tracked in [model-source-audit.json](jm6/model-source-audit.json), including blocked models. Archives and original weights are checked against release digests where published. PyTorch files use `weights_only=True`; FDAT originals are safetensors. Source cache: `/workspace/.model-sources/jm6`.

The user added Hugging Face domains to reusable environment settings. Fresh checks on this task still report observed revision 1, an enforced host list without HF, and CONNECT 403 for both official model APIs. This task cannot apply the new environment configuration. Resume download checks in a task attached to the updated saved/published environment; confirm the observed revision and host readiness before testing redirects and file hashes. No proxy bypass or unknown mirrors are used. UltraSharpV2 and AdaptivePhotoNet are not installed or tested.

The author's FP32 ONNX archive was also inspected: it contains DAT2/HAT variants, not the requested FDAT XL models. These variants are not substituted. The original FDAT XL BF16 graph failed to load on CPU (`Conv(22)` implementation missing). Promotion of BF16 tensors/casts to FP32 produced a real 32×32→128×128 output for Detail; reference validation against the exact original weights is required before support or packaging.

## Remaining implementation stages

1. Unified verified model discovery and fixed-height model names; preserve the previously valid folder when selection is cancelled/invalid.
2. Isolated ONNX worker and DirectML packaging; preserve NCNN and journal/adoption semantics, per-image failure handling and capacity one.
3. Validate FDAT Detail/Denoise, Alchemy and adaptive 3D LUT against official originals. Retry the two HF models only in an updated environment.
4. Integrate dimension-preserving color, real effect strength, ordered stages, memory admission and checkpoint recovery.
5. Package one top-level `models` folder with weights/manifests/licenses for validated redistributable models; clean-profile Windows acceptance, Installer/Portable, actual artifact checksums and an honest per-model status table.
