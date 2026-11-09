# Upscayl Enhanced 2.15.0-jm.1 — review build

## Scope and state

Enhanced **Batch** uses the vendored native pipeline. Single Image and Double Upscayl retain their original handlers/engine; Pause is available for batch jobs only. No per-image process fallback is used. If the enhanced binary is missing, batch start reports an error instead of silently changing execution strategy.

Step 4 places Pause alongside Upscayl. Running → Pausing means the admission gate is closing while accepted images drain. Only native process close **and** completion of validation/journal work allow Paused. Resume starts a fresh process containing only unfinished images. Cancel remains separate: it may terminate the engine, preserves successful outputs and the recovery record, and never treats partials as completed.

The batch progress overlay is replaced by inline batch status so Pause/Resume/Cancel stay accessible. Other modes keep the existing overlay. Button labels have translations in all existing locale files; detailed status text currently falls back to English except Arabic. The native recovery dialog currently uses English.

## Persistence and safe output

- Each start gets a unique `upscayl_<uuid>` output directory. Starting from the beginning leaves the previous session and outputs intact; it never overwrites them.
- `.upscayl-session/state.json` stores independent image states, ordered inputs, source hashes, sizes, model/engine hashes, immutable saved settings, output hashes, attempts, phase and timestamps. A checksum envelope, fsynced temporary snapshot, atomic replace and previous snapshot backup protect updates.
- User-data registry points to these sessions. If session-directory creation fails, state is placed in the registry area. The output directory itself must still be writable.
- Every accepted successful encoder record is fully decoded with Sharp (`stats`), checked for dimensions/format, optionally given metadata from the correct source image, and hashed. State is persisted as `committing` before final adoption.
- Temporary files live in a unique `.upscayl-work-<uuid>` directory in the output filesystem. A hard link atomically creates the final name with no overwrite, then the temporary name is removed. This requires a filesystem supporting hard links (use **NTFS** on Windows); unsupported filesystems fail safely and keep the session. There is no unsafe overwrite fallback.
- Source/model/engine/settings are verified on Resume; sources are also hashed before adopting each image. Completed outputs are decoded and rehashed before reuse. A corrupt final file is preserved and a new retry filename is used. A `committing` final with the expected hash is reconciled without reprocessing.
- After all images are validated and completed and the engine has exited, owned temporary directories/session snapshots/registry entries are removed. Failed, cancelled, paused and interrupted jobs keep their records. Only explicitly recorded work directories are removed.
- Images directly inside the selected folder are supported, matching the existing batch UI. Subfolder recursion is not introduced.

A normal window close requests drain and waits; the application can remain open during Pausing. OS forced termination/power loss cannot wait. The native heartbeat lease stops further admission after host loss; stale process PID detection blocks recovery while the recorded engine is still alive. A very narrow crash between process spawn and PID persistence can leave an unrecorded process that drains after lease expiry. It writes only its attempt's temporary outputs. No claim is made that hard power loss is fully preventable; Windows directory fsync has no portable Node equivalent, so recovery checks remain essential.

Enhanced enforces a single application instance per user-data profile. Session files are not an import format for untrusted users. Source changes block recovery rather than silently mixing datasets. Missing/corrupt session primary and backup are retained for manual inspection.

## Tests

```powershell
npm ci
npm run tsc
node --test tests/jobs/*.test.cjs
cl /std:c++17 /utf-8 /EHsc tests\jobs\protocol.cpp /Fe:protocol-test.exe
.\protocol-test.exe
npm run build
node tests/jobs/ui.smoke.cjs
```

JavaScript tests use a three-worker simulator, real image encoding/decoding, real process pipes and filesystem persistence. They cover drain, repeated Pause, Resume/skip, shutdown, recovery, corrupt output, model/source/settings mismatch, image failure, Cancel retention, interrupted commit, and a 1000-image ledger advancing beyond 200 and 400. They are **not** GPU/performance tests. C++ tests check the actual admission/lease/manifest helper with a bounded simulated queue. Windows-native runtime, WIC, GPU drainage and hard power loss need the manual matrix below.

## Windows build / installation

The Linux cloud environment has no Windows compiler/runtime. No Windows EXE or successful Actions URL is claimed before a completed Windows run.

After these source changes are reviewed and made available in the GitHub branch, run **Actions → Build Upscayl Enhanced Windows (review build) → Run workflow**. Pull requests touching the feature also trigger it. The workflow fetches pinned engine dependencies, compiles the modified engine, runs session/protocol tests, builds Next.js, then packages Windows x64 NSIS EXE and ZIP. It never publishes a release.

Artifacts are named `Upscayl-Enhanced-2.15.0-jm.1-Windows-x64`, with checksums. Download them from the actual completed Actions run; no fabricated URL is provided.

Local Windows equivalent after installing Vulkan SDK 1.4.363.1, CMake 3.31, MSVC x64, Node 18.20.5, Python and Git:

```powershell
npm ci
python tools/build-enhanced-engine.py
npm run tsc
node --test tests/jobs/*.test.cjs
npm run build
npx electron-builder --win --x64 --config tools/enhanced-builder.cjs --publish never
```

Packages go to `dist-enhanced`. Product/AppID, shortcut and user-data directory are separate from Upscayl. Automatic upstream updates are disabled for Enhanced; original installation and preferences are not overwritten. Prefer extracting ZIP into a new folder first. The build is unsigned: Windows SmartScreen may show an unrecognized publisher. No certificate/signing identity is embedded.

## Manual acceptance on Windows / RTX 3060 Ti

1. Use copies of a small folder, then 500–1000 representative images. Confirm ordinary Single/Double still work and batch output agrees with the original at identical settings.
2. Pause with multiple accepted images; verify Pausing, continuing completions, engine exit and only then Paused. Monitor VRAM on the same adapter; driver/Electron allocations may remain.
3. Resume twice, checking that completed output modification times stay unchanged.
4. Close during Running and Pausing; reopen and accept recovery. Also select the same folder to discover recovery. Start From Beginning must create a different output directory. Cancel in the dialog must preserve the record.
5. Kill the review app / engine; restart only after the old engine exits. Simulate disk full, locked files, corrupt image/output, model change and Arabic/Japanese paths.
6. Verify session progress beyond 200 then 400, cleanup only on complete success, and preservation after failures.
7. Compare pipeline throughput with the existing `tools/benchmark` tools and native baseline. No acceleration or no-regression claim has been established. Full output validation, source hashing and snapshot fsync add overhead that needs measurement.
