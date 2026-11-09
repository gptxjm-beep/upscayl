# Upscayl Enhanced 2.15.0-jm.2 review build

The original Step 4 is restored. Batch Pause/Resume appears beside STOP in the original progress card. Pausing keeps that card visible until accepted pipeline work drains, validated images are journaled and the native process exits. Paused means that process has exited. Resume rechecks saved settings, model/engine/source hashes and adopted outputs before processing remaining images. Single and Double retain their original engine route.

Settings no longer parses the application name out of the user agent. The original unguarded regex did not match the Enhanced product and dereferenced null. Version now comes from the existing preload API; system-information rendering also tolerates absent/nested values.

Native diagnostics identify decode/inference/encode failures, native return codes, WIC HRESULTs, full stderr and process exit code/signal. JSONL logs are saved under `%APPDATA%/Upscayl Enhanced/logs/batch-<session-id>.log`. They contain local input/output paths; inspect them before sharing. A generic jm.1 image-failure message alone cannot establish its exact cause on a user's GPU. The CI comparison runs the actual jm.1 engine and jm.2 against the same six-image software-Vulkan fixture and reports the reference result without assuming it fails.

Output folders have readable names such as `upscayl_png_high-fidelity-4x_5x`, with numbered suffixes when needed. `.upscayl-session` contains the journal, backup and work files. Work is removed after draining; Pause retains the journal and completed images. Success removes session files. Interrupted attempts are reconciled on recovery; corrupt final files are preserved and replacements receive `_retry_2` suffixes. Existing jm.1 folders are not removed. STOP explicitly cancels and retains validated images and a recoverable record.

## Checks and local reproduction

Use Node 18.20.5 and `npm ci`, then:

```powershell
python tools/build-enhanced-engine.py
npm run tsc
node --test tests/jobs/session.test.cjs tests/jobs/asar-path.test.cjs
node --test tests/jobs/native-functional.cjs
npm run build
node tests/jobs/ui.smoke.cjs
```

The native functional tests force Electron's bundled SwiftShader ICD for child processes. They run real model inference, decode outputs and verify dimensions, Pause/drain and recovery without reprocessing completed files. They are correctness tests, not benchmarks or NVIDIA GPU validation. UI tests navigate/edit Settings with an Enhanced user agent and inspect the original progress card using synthetic job states; they do not claim GPU interaction coverage. Windows CI additionally compiles WIC/thread and protocol tests and verifies both installer and ZIP payloads against the just-built engine hash, original model hashes, runtime DLLs, x64 PE headers and packaged application routing.

## Windows acceptance

Install to the separate Upscayl Enhanced location, or extract Portable ZIP to a new folder. Keep the original Upscayl installation. Enhanced uses a separate application ID and user-data folder and disables its upstream updater. This is an unsigned test build, not an official release.

On the RTX 3060 Ti, test six mixed JPG/PNG images with High Fidelity at 5x, including paths with spaces, Arabic and `%!`. Verify the center STOP/PAUSE row, Pausing → Paused, repeated Pause, Resume, STOP, Settings navigation, closing/reopening after Pause and unchanged completed-image timestamps. Check Single and Double separately. Report the exact settings and share the batch log if inference fails. Test larger/long pages only after the small batch passes. No performance or real-GPU claims follow from the CI status.

The build artifacts include `SHA256.txt` and `delivery-manifest.json` with exact names, sizes, hashes and the source commit. Validate downloads with `Get-FileHash <file> -Algorithm SHA256` before testing. GitHub Actions artifact downloads require signing in.
