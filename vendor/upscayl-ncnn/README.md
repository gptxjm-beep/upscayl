# Enhanced engine source

Vendored from `upscayl/upscayl-ncnn`, tag `20240601-103425`, commit and dependency pins in `ORIGIN.json`. Upstream license is retained in `LICENSE`; third-party headers keep their embedded notices. Original binaries remain untouched. This tree produces `upscayl-jm(.exe)` only.

Changes:

- `src/session.h`: optional v1 session protocol, UTF-8 hex manifest parser, admission gate, heartbeat lease, synchronized completion records.
- `src/main.cpp`: `-L <manifest>` / `-Q <control-directory>`. Manifest records are `hex(absolute input UTF-8) TAB hex(absolute temporary output UTF-8) LF`. IDs are zero-based manifest ordinals. Without `-L`, the original CLI remains usable.
- Each loader checks `pause` and the `lease` file **before accepting a new image**. An image past this check is accepted, including decode/prefetch. Accepted work drains through the unchanged bounded `toproc` / `tosave` queues. Pause is latched; deleting a sentinel does not resume the same process.
- The host updates the lease every two seconds; a missing lease or a lease older than 15 seconds stops admission at the next check. This protects against a crashed host, but is not immediate process termination. A blocked GPU call cannot be interrupted gracefully.
- Encoder completion emits a synchronized ASCII stdout record `@JM1 <ordinal> <0|1>`. Logs stay on stderr. Failure records are emitted for decode/process/encode failure; exit status 2 denotes image failures. The application commits images only from successful per-image records plus independent decode/dimension/format/hash verification. It does not mistake a batch exit status for the status of every image.
- `RealESRGAN::load` propagates model-loading failures; partially initialized cleanup is guarded. Input/extraction failures propagate; allocator return uses RAII. Initialized WebP ownership metadata fixes an upstream undefined field.
- CMake uses UTF-8 source encoding on MSVC. GPU tiling, TTA, model weights, default processing threads and encode settings are retained.

Model creation/loading remains outside the pipeline. The model is loaded once per process/GPU and destroyed only after all pipeline threads join. Pause closes that process; Resume loads the model once for the remaining batch, not once per image. Native queues can hold multiple accepted images; Pausing can therefore take longer than one image.

## Build

Requires C++17 compiler, CMake 3.31, Vulkan SDK (including `glslangValidator`), Python and Git. The helper fetches exact NCNN/libwebp commits and their submodules into ignored dependency folders. It refuses dirty dependency checkouts. It does not overwrite original `upscayl-bin` binaries.

```powershell
python tools/build-enhanced-engine.py
```

Output: `resources/win/bin/upscayl-jm.exe` on Windows, `resources/linux/bin/upscayl-jm` on Linux. Extra `-D...` CMake arguments may be supplied after the script. Build with bounded parallelism (2). There is no model download or GPU benchmark in this helper.

The reproducible Windows path is `.github/workflows/build-enhanced-windows.yml`. Source/dependency pins are recorded; bit-for-bit reproducibility and matching the old binary toolchain are not claimed. New engine runtime behavior still requires tests on an actual Vulkan GPU.
