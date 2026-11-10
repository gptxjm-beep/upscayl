# Upscayl Enhanced jm.5 — development status

Base: `257dccdbaa2c1ba9e628f3a456327a6e87b517ed` (jm.4), preserved on `fix/jm4-recovery-ux`.
Development branch: `feature/jm5-long-png-two-stage`. This is incremental work, not a completed release or GPU performance claim.

## Stage 1 — long PNG and safe single output

The Windows normal-size PNG route retains WIC. Final dimensions above 65535 select row-at-a-time libpng before attempting WIC. A WIC `WINCODEC_ERR_IMAGESIZEOUTOFRANGE` on an otherwise ordinary image retries libpng using the already processed pixel buffer; no new AI inference is scheduled. Other WIC errors do not trigger this fallback. The alternative writes one full-height PNG, converts Windows BGR/BGRA correctly, and allocates codec row/work buffers rather than another full raw image. Encoder selection, dimensions and the reason are logged; normal WIC selection is logged once per engine process.

Pinned libpng 1.6.47 and zlib 1.3.1 sources, their commits and bundled license texts are recorded. Both libraries link statically. zlib configures an owned build-directory copy because its CMake renames a source header; dependency checkouts remain clean and are never reset over user changes.

Single Image uses the enhanced engine, a unique same-directory temporary file, correct engine exit status, full decode/dimensions/format verification and flush before atomic adoption. Existing results are preserved unless overwrite was explicitly selected. A corrupt pre-existing result is not reported as success. STOP or encode/validation failure removes only the owned temporary file. Batch retains the existing journaling/adoption protocol and native Pause gate.

Local validation: real libpng writer/full decoder at 1440×70200 and 65535/65536 boundaries; independent full Pillow decode; BGR and alpha checks; invalid dimensions/missing destination and Linux `/dev/full` rejection. Atomic-output and real Single callback tests reject nonzero exits, partial files and cancelled work, and preserve an existing file. The jm.4 session regression suite passed. Windows validation is performed by the branch workflow.

Limits: these are controlled codec/functional fixtures, not the user's original manhwa after GPU inference. Physical Windows viewers, real disk-full on Windows, original-image quality, 100-image timing and RTX 3060 Ti VRAM/performance are not established by these tests. libpng removes this WIC dimension boundary, not RAM/native integer limits or viewer limits. The existing native resize path conservatively rejects pixel buffers above its supported integer range.

## Models under evaluation

Official release 1.0.0 files downloaded for evaluation: IllustrationJaNai V1 ESRGAN 4x and MangaJaNai 1600p V1 ESRGAN 2x. Illustration's original SHA-256 matches OpenModelDB. Both are ESRGAN/RRDB 64nf/23nb; Manga 2x uses pixel unshuffle before a 4x body and requires alignment, so simply adding a name/scale is insufficient. The native path now enables Reorg, honors explicit native scale on Windows, aligns 2x pixel-unshuffle inputs and validates the extracted tensor shape. Tiny-image reflection and odd last-tile alignment receive explicit boundary handling. Original files, conversion/reference tooling and an opt-in license-acknowledged import gate are implemented in `tools/models`. Broader functional cases are still running; compatibility is claimed only for cases recorded in passed import manifests. The version-specific LICENSE at the author's 1.0.0 tag is CC-BY-NC-SA-4.0, even though the current default-branch license differs. Optional weights will not be silently bundled with the app.

Manhwa Null 1x has published source SHA-256 `7d7cee6e08f72cd231fa0d5083e7ec13fb464eff82cae73e0b1292ac6fe51f87`; its official Proton Drive source is blocked by this environment's network policy. No compatible conversion or quality claim is made without the original weights. No invented MangaOra entry is added.

Two-stage scheduling remains a separate stage; drag-and-drop is implemented independently below. GPU benchmarks must run on suitable hardware, using identical inputs/settings and at least three alternating runs; caches are not assumed flushed.

## Stage 4 (isolated early repair) — native file drag-and-drop

Electron 33 does not provide File.path. The preload exposes only the official webUtils.getPathForFile bridge. A native-backed File is resolved, then main validates an absolute local filesystem path, extension, readable regular file, actual format, dimensions and full decode. Missing MIME is accepted. The renderer replaces its image/output state only after success, preserves it on invalid input, rejects link-only drops, and ignores files outside the preview instead of navigating. A pending status is shown while reading. Window-level drop prevention and a main-frame navigation guard add protection without changing the existing security preferences.

Native picker paths remain filesystem paths through Single and Double; literal '%' and '%20' filenames are not URI-decoded again. Select Image also keeps the previous image until validation succeeds or the chooser is cancelled.

Local tests passed for backend path/content validation and the real native-backed File → Electron preload bridge → preview flow: JPG, PNG, WEBP, empty MIME, Arabic/spaces/%20/deep paths, invalid input preservation, outside drops, links, retry, Select Image and navigation rejection. Linux's documented Electron/libvips assertion requires executing the same validation function in external Node during this local UI test; this is explicit in test output. The Windows packaged test uses the real main IPC handler and bundled Sharp, with no such override, and additionally attempts preview of the controlled long PNG. Packaged-Windows results remain pending until that workflow passes.

Windows run 42922904693 passed persistent sessions, native protocol, WIC and the 1440×70200 streaming PNG/full independent decode checks. Packaging and packaged UI checks must still pass; these codec checks are not GPU performance tests.
