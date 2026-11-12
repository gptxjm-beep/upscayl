# FDAT XL DirectML repair candidate — Windows 10 x64

Target: Windows **10** x64, NVIDIA RTX 3060 Ti 8GB, Core i5-14400F, RAM16GB. This supersedes older Windows11 device descriptions. Windows2022 CI success is neither a Windows10 execution test nor proof of NVIDIA compatibility.

## Findings and limits

The two shipped FDAT graphs are FP32, IR12, ONNX **opset23**, with4331 nodes/1005 original initializers. Alchemy and3DLUT use opset17. Microsoft's published DirectML EP documentation states support up to opset20, but the pinned1.31.1 registration source already includes opset21 entries. Therefore the documentation alone is not an exact support matrix, and **opset23 alone does not prove the root cause**. More specifically, the pinned DML registration table has no standard-domain `Gelu` registration (181 such nodes in FDAT), while `com.microsoft.Gelu(1)` and standard `Erf(9,13)` are registered. This is a concrete partitioning concern addressed by exact-erf lowering; actual placement/failure attribution still requires a real DML optimized graph/profile. Both FDAT models load before inference fails, including on a720×804 source, so a corrupt model or total-page VRAM exhaustion must not be assumed.

`0x8007023E` is HRESULT_FROM_WIN32(ERROR_UNHANDLED_EXCEPTION574), not E_OUTOFMEMORY. In the pinned ORT1.31.1 source, MLOperatorAuthorImpl.cpp:2680 propagates an operator exception. The inserted `MemcpyFromHost / Memcpy_token_2787` node invokes CopyTensors across a runtime partition; the token is absent from the original graph. The copy node is the observed failure site, not a proven faulty original FDAT operator. Actual DML profiling/driver information is still needed.

ORT1.31.1 remains pinned; bundled DirectML.dll is1.15.4 (SHA256 d16be72fa002dd610cca93e376f0ef44865dfce43de4b7bf9738af22534f7a9d). DirectML supports Windows10 and DX12 GPUs, including RTX3060Ti; Windows11 is not intrinsically required by this path. OS-built-in DirectML was introduced with Windows10_1903/build18362; this is **not a claim that every Windows10 build meets all requirements of this newer redistributable**. Exact user OS build, NVIDIA driver, D3D12 device creation and actual loaded DLLs are collected by the diagnostic. No unsupported WinML/Windows11-only migration, automatic driver installation or guessed minimum NVIDIA version is applied. Microsoft's VC++2015–2022 x64 runtime is required: https://aka.ms/vs/17/release/vc_redist.x64.exe .

For tile128/halo32, both reported sources start with a160×160 tensor; an interior tile is192×192. For720×804, the final tile is112×72. FDAT always predicts4X before the existing final2X resize. The new logs distinguish original/final image dimensions, native tensor shape, tile origin/core, halo, dtype, model/graph/source hashes, provider, resolved DXGI device index and exact exception/HRESULT. `rawdevice:null` alone is not evidence of incorrect adapter selection.

## Candidate changes

* FDAT-only semantic lowering from23 to17:181 exact-erf GELUs expanded into primitive operators;108 constant reduction axes converted to attribute form. All1005 original serialized initializers remain **bitwise identical**, FP32 unchanged, IR12 unchanged. This is not merely relabelling an opset header or substituting another model. Independent original-weight reference PNGs are reused and compared by actual ORT inference before adopting a validated manifest.
* FDAT-only DirectML session construction binds the existing named spatial dimensions to the actual padded tile dimensions, following Microsoft's fixed-shape guidance. CPU, Alchemy,3DLUT and NCNN keep their existing session/math configuration. No CPU fallback is introduced. Sequential execution and disabled memory patterns remain enabled as required by DML.
* One resident ONNX session remains the limit. A tile shape change releases the prior session before creating another; repeated equal shapes reuse it. This may increase initialization cost at image borders and must be measured on the target GPU. No NVIDIA performance claim is made.
* Original HRESULT is retained in logs, per-image failures and reports. Model-load failures and device loss stop the job; the existing bounded consecutive-inference-failure policy remains. `8007023E` alone is not labelled OOM.
* Existing admission, ACK, two-stage checkpoints, safe output adoption, Pause/Resume and recovery architecture are unchanged. Saved model/worker hash checks remain strict: a session created with the old FDAT graph must not silently resume against different graph bytes. Keep old application/models until any old session is resolved. Completed output files are never reprocessed or deleted by this repair tool.
* Five other models are copied byte-for-byte from the verified baseline. Updated FDAT manifests explicitly require the new graph profile; import the **updated models ZIP together with the candidate app**.

## Validation and test budget

Local real CPU reference: three images/model (32×32,35×33 with tiles,12×97 long/narrow), maximum absolute pixel difference1 for each, unchanged thresholds PSNR≥40dB, MAE≤2, maxAbs≤24. The graph audit proves original-initializer identity. No GPU exists in this cloud executor.

Local targeted suite:30 passed, including both stage failures, memory stop, output protection, model discovery, pause and abrupt-controller recovery. The initial name-filter inadvertently included the small50-image colour fixture once (4.2s); an explicit `JM6_FDAT_TARGETED=1` now skips that case in the candidate workflow. No1000-image test was run. No native50-image suite is rerun.

Candidate Windows2022 CI uses the exact prior verified native engine, reuses prior original-weight reference pixels, executes3 CPU reference cases/model, short critical recovery tests, all7 packaged models on one image each plus2 selected pairs, and the diagnostic's3 tensor probes/model on CPU. This verifies packaging/functional regressions only. Read-only platform collection in CI is a tool smoke test, not target-device validation.

## On the user's Windows10 machine

1. Keep the previous app/model folder. Extract the new Portable to a separate folder; extract the corrected models ZIP separately and select its `models` directory in Settings. Do not overwrite an active old session's models.
2. Close image-processing jobs, open Command Prompt, then run (paths are examples):

   ```bat
   "C:\JM6-candidate\resources\diagnostics\FDAT-DirectML.cmd" "C:\JM6-corrected\models"
   ```

   Default:3 tensor probes/model (160×160,192×192,112×72), TTAoff, FP32, GPU0, no CPU fallback. These are **not complete images**. Failures stop further probes for that model. Output location is printed, with `summary.json`, original errors and ORT profiling JSON. DXGI enumeration shows which adapter index0 actually selects; software adapters must not be counted as NVIDIA validation.
3. If probes pass, run the same command with `--full`:3 complete controlled images/model (256×256,512×512,720×804), tile128/halo32, PNG final2X. This checks output full decode/dimensions. Diagnostic input/output files stay in its own new temporary folder; original images are not used. Optional `--dynamic` is a diagnostic control for the same corrected graphs, not a CPU fallback. Run only if comparing static-vs-dynamic behavior is necessary.
4. In the app, test FDAT Detail and Denoise on the previously failing720×804 image and then000558.jpg720×6120, final2X PNG, tile128, TTAoff. Compare to original-weight quality and use the normal processing card. Do not start a50-image rerun merely to diagnose the same failure. Follow with one Alchemy→3DLUT and one NCNN Illustration regression; check completed output preservation.
5. Share the generated `summary.json` and profiling files plus relevant existing app Logs. They contain OS build/driver/model hashes/tensor shapes/exceptions; inspect before sharing. Console/ORT logs may contain local paths. The read-only PowerShell probe does not request admin, bypass execution policy, alter registry/driver/security settings or send anything over the network. If local policy blocks a probe, its failure is reported rather than bypassed.

`--cpu` exists solely for explicitly labelled CI/functional verification; it is **not** a solution to the DirectML failure. Diagnostic summaries intentionally retain `gpuFixProven:false`; even successful probes require the user's complete-image and regression checks before declaring the device fixed.

## Sources

* DirectML EP requirements, opset and shape guidance: https://github.com/microsoft/onnxruntime/blob/gh-pages/docs/execution-providers/DirectML-ExecutionProvider.md
* Pinned operator registration table (standard Gelu versus Erf): https://github.com/microsoft/onnxruntime/blob/v1.31.1/onnxruntime/core/providers/dml/DmlExecutionProvider/src/Operators/OperatorRegistration.cpp
* Exact exception propagation: https://github.com/microsoft/onnxruntime/blob/v1.31.1/onnxruntime/core/providers/dml/DmlExecutionProvider/src/MLOperatorAuthorImpl.cpp
* Runtime copy node: https://github.com/microsoft/onnxruntime/blob/v1.31.1/onnxruntime/core/providers/dml/DmlExecutionProvider/src/Operators/DmlOperatorMemcpy.cpp
* DirectML version history: https://github.com/MicrosoftDocs/windows-ai-docs/blob/docs/docs/directml/dml-version-history.md
* Win32 error definition: https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/shared/winerror.h
* Baseline original-weight/packaging evidence: https://github.com/gptxjm-beep/upscayl/actions/runs/43151751265

UltraSharpV2 DAT2 and AdaptivePhotoNet6M remain pending future JM6 requirements. No integration/download changes for those models are included in this focused repair.
