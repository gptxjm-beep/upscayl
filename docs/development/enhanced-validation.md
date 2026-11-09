# Current-instance validation — 2026-11-09

Historical pre-build jm.1 snapshot. Later jm.1 Windows packaging succeeded but user GPU acceptance failed. Current jm.2 scope and test limits are documented in [Enhanced-jm2.md](../Enhanced-jm2.md); actual build status must be checked on its Actions run.

Prepared on Linux x64. These are observed results, not Windows/GPU certification.

- TypeScript main and renderer checks passed.
- Production `npm run build` completed (Next.js static renderer export and locale checks).
- Full session suite: 9/9 passed, including a real-filesystem 1000-image simulator run with persistent checkpoints beyond 200 and 400. A subsequently added Cancel/new-batch race regression also passed; affected Cancel/restart checks were rerun after the guard change.
- Five existing independent benchmark correctness tests passed; no performance benchmark ran.
- C++ session protocol test passed with `-std=c++17 -fno-exceptions -pthread`.
- Electron Playwright smoke passed: idle/Running/Pausing/Paused/Completed controls and 650px viewport button alignment. State events in this test are synthetic. Actual native GPU processing was not exercised.
- Modified Linux native engine fully compiled and linked against the pinned NCNN/libwebp sources. The build helper completed again using cached outputs. A compiled-binary check rejected an invalid session manifest before Vulkan initialization.
- Linux engine SHA-256: `55900b3fa50dbd0dd98cd6340a3e79e042f836ab8517067978d165df9dcfde19`.
- Original Linux and Windows engines retained their previously recorded SHA-256 values; model files were not modified.
- Windows compiler/runtime and a suitable GPU were not available. Windows workflow has been added but **not executed**. No Windows installer/ZIP/download URL exists from this session. Shader/inference correctness, real VRAM release, native WIC behavior, performance and power-loss recovery still require the documented Windows acceptance run.

Generated native binaries, dependencies, UI screenshots and build directories are ignored local outputs. No Git commit, push or release publication was performed. Existing benchmark files and the pre-existing `renderer/next-env.d.ts` modification were preserved.
