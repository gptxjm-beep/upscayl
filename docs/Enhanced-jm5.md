# Upscayl Enhanced jm.5 — implementation and acceptance

Development branch: `feature/jm5-long-png-two-stage`.
Stable reference remains `fix/jm4-recovery-ux` at `257dccdbaa2c1ba9e628f3a456327a6e87b517ed`.
No main merge or official release is part of this work.

## Image-local errors and final report

Both managed single-model batches and two-stage batches record a failed image and continue to the next image. Decode/geometry errors, an individual model-stage failure, invalid intermediate output and invalid final output cannot count as successful images. A first-stage failure cannot enter stage two. The native two-stage worker releases its capacity only after the host durably records final adoption or failure; a rejected checkpoint also releases the failed image instead of exiting or hanging on ACK.

`completed-with-errors` is a separate terminal state. It requires every image to have a final completed/failed state and no job-wide fault. Pausing with images still pending remains Paused. Cancelling never presents a completion summary. A failed-image counter remains visible while work continues; individual errors do not open blocking dialogs.

At completion with errors, `upscayl_batch_report.txt` is written atomically in the **final output directory**. It contains UTC date, job name/ID, models, totals and each failed filename, stage, concise reason and available native code. Detailed diagnostics stay in the existing Logs directory. A bounded `batch-<id>.errors.log` stream retains early failures even when verbose stage traces rotate. UTF-8 with BOM and CRLF supports Windows readers. An edited or locked older report is preserved using a fresh numbered report. The dark Completed with Errors dialog opens the report, output directory or Logs using job-scoped main-process handlers.

Model initialization, disk/destination faults, journal persistence failures and process crashes stop the job. Three consecutive inference, generic encoding or validation failures trigger a conservative circuit breaker. Already adopted outputs remain protected. Known per-image dimension/decode errors do not trigger this breaker. If durable journaling fails, only this manager's child is terminated so it cannot wait forever for an ACK that cannot safely be issued. Recovery retains the last valid atomic snapshot.

A finished-with-errors job remains discoverable when its folder is selected again. Explicit Resume retries failed images and skips verified completed outputs. A user may repair a **failed** source externally before this retry: the new hash/dimensions are pinned and its obsolete checkpoint discarded. Completed-source identity and both model/settings identities remain strict. Inputs are never changed by the app. Repair intent survives interrupted preflight. Existing reports are refreshed after a successful retry; a previous real report is retained during Pause/Cancel rather than falsely presented as a new completion.

## Long PNG and safe output adoption

Normal Windows PNG retains WIC. Final dimensions above 65535 use streaming libpng directly. A WIC `WINCODEC_ERR_IMAGESIZEOUTOFRANGE` on an ordinary-size output retries libpng from the existing processed buffer. Other WIC errors are not blindly retried. The result is one full-height PNG, with proper Windows BGR/BGRA conversion and row-sized codec work buffers. This removes one encoder boundary, not RAM/native integer or viewer limits.

libpng 1.6.47 and zlib 1.3.1 are pinned and statically linked; their license texts ship in the app. zlib configures a build-directory copy, leaving source checkouts intact. Single uses a unique owned temporary file, successful child exit, full decode/dimensions/format checks, flush and atomic adoption. Managed batches retain journaled no-overwrite adoption, full validation and original-file protection.

The real writer and independent decoders passed 1440×70200 and 65535/65536 boundary tests, plus BGR/alpha and write-failure tests. Earlier Windows runs passed these codec checks and packaged Electron preview. This is **not** a claim that the original 720×35100 page completed AI inference on an NVIDIA GPU. Real Windows viewers and physical Windows disk-full remain acceptance items.

## Verified optional models

| Model | Native scale | Input multiple | Host padding | Precision | Original license |
|---|---:|---:|---:|---|---|
| Manhwa Null | 1X | 4 | 12 | FP16 storage | CC-BY-NC-SA-4.0 |
| IllustrationJaNai V1 ESRGAN | 4X | 1 | 10 | FP16 storage | CC-BY-NC-SA-4.0 |
| MangaJaNai V1 ESRGAN 1600p | 2X | 2 | 10 | FP32 activations | CC-BY-NC-SA-4.0 |

All are ESRGAN/RRDB networks. Manhwa Null's first convolution has 48 input channels after PixelUnshuffle4; native output scale 1X does not imply input alignment 1. Padding and tile origins preserve that 4-pixel phase: padding is 12 and a nonaligned tile request is rounded down to a multiple of 4. Default Upscayl models retain their normal padding/tile behavior. Explicit `-z` native scale is honored on Windows as well as Linux; extracted tensor geometry is checked before postprocessing. Reorg is enabled explicitly even in incremental builds.

The user provided Manhwa Null in three parts. Each part and the reassembled 67,132,992-byte original matched its manifest; the final SHA-256 is `7d7cee6e08f72cd231fa0d5083e7ec13fb464eff82cae73e0b1292ac6fe51f87`, matching OpenModelDB. The unchanged original, attribution, source and separate license are in `vendor/optional-model-sources/Manhwa-Null`. Original Manga/Illustration weights come from the author's **1.0.0** release. Its license differs from the author's current default-branch license; the version-specific ShareAlike text is used.

`tools/models/prepare.py` checks original SHA before `torch.load(weights_only=True)`, validates architecture/RGB/scale/alignment, exports a wrapper without shape-dependent crop, optimizes with NCNN 20240410 and runs actual native Vulkan inference. It compares against the original PyTorch model with the same padding, tiling and TTA policy. Thresholds remain PSNR ≥40 dB, MAE ≤2 and max absolute error ≤24. Real-page quality and untiled/full-context equivalence are separate questions. Manga's FP16 tiny case failed; selecting FP32 activations fixed it without relaxing thresholds or changing stock-model precision.

All three passed regular, odd, tiled, tiny-border and TTA RGB fixtures. Manhwa also passed a narrow 12×601 long-image case, including a 33-pixel tile request effectively aligned to 32. Exact source/converted hashes, tested engine identities and pixel metrics are in `tests/evidence/jm5-model-reference.json`. These are synthetic functional comparisons on software Vulkan. Windows and physical NVIDIA acceptance must be read from an actual successful current build/test run.

Optional weights remain separate from the default app's seven models. An import is selectable only with an acknowledged license and a passed manifest matching source identity, native metadata and file hashes. Manhwa requires the corrected padding metadata. A 1X model offers genuine 1X cleanup; the UI explains additional traditional enlargement when used alone. See `tools/models/README.md` for reproducible import and variant/quality limits. No undocumented MangaOra model is added.

## Two-stage execution and recovery

Step 2 has the original first picker, a default-off checkbox, an always visible disabled second picker and one final scale. Arabic/English labels, keyboard behavior and disabled states are covered. Disabling the checkbox omits the new payload fields; Classic Double remains a distinct mutually exclusive path. Default single-model queues/threading are retained.

The opt-in native worker runs each complete image in file order:

`original → model one → validated durable PNG checkpoint → model two → final resize once → validated atomic adoption → durable journal → ACK → next image`

Capacity stays **one whole image**. There is no folder-wide first pass. Cached networks stay resident when a conservative heap/weight/workspace estimate permits; otherwise one-resident mode logs its stage-switch reload cost. A second resident load failure retries after unloading the other network. This is a preliminary memory policy, not a measured optimum for RTX 3060 Ti. GPU driver allocation behavior and real VRAM require hardware tests. Per-frame integer bounds and host-RAM estimates reject unsafe compound enlargement before allocation; no silent resize is inserted between models.

New two-stage sessions use v2 stage state and bind each checkpoint to owner, both model hashes, settings, source hash, size and file hash. A valid checkpoint resumes stage two; missing/corrupt/unbound data restarts stage one. Completed images are checked and preserved. Managed Single contains only the selected source, never its folder neighbors. STOP/Pause/Resume remain in the original center card. Paused requires the worker to have exited and GPU resources to have been destroyed.

v1 journals remain readable. Only exact verified Windows jm.3, jm.4 and the known `857c070` v2 worker identities can migrate to the compatible current protocol; arbitrary changed workers remain rejected. Cancellation cleans owned work/checkpoints and keeps final outputs/reports.

Both `Manhwa Null 1X → IllustrationJaNai 4X → Final 2X` and `MangaJaNai 2X → IllustrationJaNai 4X → Final 2X` are compared to two ordered native invocations with one final resize in `tests/jobs/trained-two-stage.cjs`. This tests composition on synthetic RGB, not real-page quality or hardware throughput.

## Drag-and-drop

Electron 33 paths use official `webUtils.getPathForFile` through preload. Main checks local absolute paths, supported extension, readable regular file, actual format and full decode. Missing MIME is accepted. The current image stays intact until validation succeeds. Link-only/outside drops cannot navigate the app, and Select Image follows the same preservation rule. Security preferences are not weakened as a workaround.

Native-backed File tests cover JPG/PNG/WEBP, empty MIME, Arabic/spaces/%20/deep paths, invalid input preservation, outside drops, links, retry, Select Image and navigation rejection. Earlier Windows packages passed the actual packaged-main/Sharp route and long-PNG preview. Local Linux UI validation explicitly uses external Node for the known baseline Electron/libvips assertion. Physical Explorer dragging remains a user acceptance item.

## Tests, build and remaining acceptance

Local checks include production renderer/schema/TypeScript, session/output regressions, injected per-image and job faults, actual scalar NCNN batches of **1000 images in each mode with image 50 corrupted**, repaired-source retry without changing adopted files, checkpoints/corruption, controller crash/lease expiry, native ENOSPC and repeated-inference circuit breakers, native PNG/full decode and Electron UI/IPC controls. Synthetic fixtures are labeled as such. No hardware performance numbers are inferred from test duration.

The Windows workflow triggers by push on this branch, compiles the exact engine, checks current source fingerprints, tests packaged drop/preview, verifies EXE/ZIP contents and SHA-256 and tests all three original models plus ordered pairs before publishing artifacts. Optional model tests run in the same job to avoid a second runner invocation. Private software-Vulkan DLL aliases are confined to test directories and never packaged.

Previous run `42926224886` on `857c070` is **Cancelled**, with `repository invocation blocked`; its Windows packaging job passed, but its dependent model job did not establish success. That run is not proof of the final changes. A current successful run and verified delivery manifest are required for current Installer/Portable download claims.

Still requiring suitable hardware/data: Windows 11 / RTX 3060 Ti, physical VRAM/residency/fallback measurements, 100-image original-model regression timing, 1000 trained-model real pages, original 720×35100 AI inference to 1440×70200, real comic line/color quality and physical Windows disk-full/viewers. `tools/jm5/README.md` provides guarded Windows benchmark/acceptance commands and report-sharing instructions. Original `tools/benchmark` work remains untouched.
Windows CI verification requested
