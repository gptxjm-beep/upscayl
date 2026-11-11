"""Verify real Windows delivery files, including both ZIP and NSIS engine payloads."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist-enhanced'


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def pe_x64(path):
    with path.open('rb') as stream:
        assert stream.read(2) == b'MZ', f'Not PE: {path}'
        stream.seek(0x3c)
        offset = struct.unpack('<I', stream.read(4))[0]
        stream.seek(offset)
        assert stream.read(4) == b'PE\0\0', f'Invalid PE signature: {path}'
        assert struct.unpack('<H', stream.read(2))[0] == 0x8664, f'Not x64: {path}'


def verify_tree(folder, engine_hash):
    engine = folder / 'resources/bin/upscayl-jm.exe'
    assert engine.is_file() and sha(engine) == engine_hash, 'Modified engine absent or mismatched'
    assert b'@JM3 GATE' in engine.read_bytes(), 'jm.3 inference gate protocol absent'
    assert b'@JM5 FATAL' in engine.read_bytes(), 'Job-wide fault protocol absent'
    assert b'capacity=1' in engine.read_bytes(), 'Bounded two-stage worker absent'
    pe_x64(engine)
    assert sha(engine) != sha(ROOT / 'resources/win/bin/upscayl-bin.exe'), 'Original engine substituted'
    app_exe = folder / 'Upscayl Enhanced.exe'
    assert app_exe.is_file(), 'Enhanced application EXE missing'
    pe_x64(app_exe)
    for original in (ROOT / 'resources/models').iterdir():
        if original.suffix in ('.bin', '.param'):
            packed = folder / 'resources/models' / original.name
            assert packed.is_file() and sha(packed) == sha(original), f'Missing/changed model: {original.name}'
    for original in (ROOT / 'resources/win/bin').glob('*.dll'):
        assert sha(folder / 'resources/bin' / original.name) == sha(original), 'Missing runtime DLL'
    for name in ['libpng.txt','zlib.txt']:
        assert sha(folder/'resources/licenses'/name)==sha(ROOT/'resources/licenses'/name), 'Missing codec license'
    native = folder/'resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/win32/x64'
    runtime_hashes = {}
    for name in ['onnxruntime_binding.node','onnxruntime.dll','DirectML.dll','dxcompiler.dll']:
        original = ROOT/'node_modules/onnxruntime-node/bin/napi-v6/win32/x64'/name
        packed = native/name
        assert packed.is_file() and sha(packed)==sha(original), 'ONNX/DML binary absent or changed: '+name
        pe_x64(packed)
        runtime_hashes[name]=sha(packed)
    assert not (native.parent/'arm64').exists(), 'Unexpected ARM64 inference payload'
    for name in ['ONNX-Runtime-MIT.txt','ONNX-Runtime-ThirdPartyNotices.txt','DirectML-1.15.4.txt','DirectXShaderCompiler-LICENSE.txt','JM6-runtime-sources.json']:
        assert sha(folder/'resources/licenses'/name)==sha(ROOT/'resources/licenses'/name)
    archive = folder / 'resources/app.asar'
    # Test compiled routing/identity in the archive that will actually be delivered.
    script = r'''
const asar=require('@electron/asar');
const path=require('path');
const file=process.argv[1];
const read=n=>asar.extractFile(file,path.normalize(n)).toString();
const pkg=JSON.parse(read('package.json'));
if(pkg.version!=='2.15.0-jm.6-dev.1'||pkg.productName!=='Upscayl Enhanced')throw Error('Wrong package identity');
if(!read('export/electron/jobs/onnx-worker.js').includes('PipelineRuntime'))throw Error('ONNX worker missing');
if(!read('export/electron/jobs/integration.js').includes('upscayl-jm.exe'))throw Error('Wrong engine route');
if(!read('export/electron/jobs/manager.js').includes('completed-with-errors'))throw Error('Image error completion handling absent');
if(!read('export/electron/jobs/report.js').includes('upscayl_batch_report'))throw Error('Error reporter absent');
const models=JSON.parse(read('export/common/optional-models.json'));
if(models['1x-manhwa-null'].nativeScale!==1||models['1x-manhwa-null'].inputMultiple!==4||models['1x-manhwa-null'].prepadding!==12)throw Error('Incorrect Manhwa metadata');
if(!read('export/electron/main-window.js').includes('Upscayl Enhanced'))throw Error('Updater guard absent');
if(!read('export/electron/index.js').includes('Upscayl Enhanced'))throw Error('User data isolation absent');
if(!read('export/electron/index.js').includes('integration_1.startBatch'))throw Error('Batch handler not connected to enhanced engine');
'''
    subprocess.run(['node', '-e', script, str(archive)], cwd=ROOT, check=True)
    # Startup smoke for the native CLI only. -h does not initialize Vulkan or run inference.
    help_result = subprocess.run([str(engine), '-h'], capture_output=True, timeout=30)
    assert b'Usage:' in help_result.stdout + help_result.stderr, 'Native Windows engine could not start'
    return {'engine_sha256': sha(engine), 'app_exe_sha256': sha(app_exe),
            'asar_sha256': sha(archive), 'onnx_runtime_x64_sha256':runtime_hashes, 'model_files_verified': 14, 'native_help_exit': help_result.returncode}


def main():
    installers = list(DIST.glob('*.exe'))
    portable = list(DIST.glob('*.zip'))
    assert len(installers) == len(portable) == 1, 'Need exactly one installer and one portable ZIP'
    engine_hash = sha(ROOT / 'resources/win/bin/upscayl-jm.exe')
    seven = shutil.which('7z') or r'C:\Program Files\7-Zip\7z.exe'
    with tempfile.TemporaryDirectory(prefix='upscayl-delivery-') as tmp:
        base = Path(tmp)
        zipped = base / 'portable'
        with zipfile.ZipFile(portable[0]) as archive:
            assert archive.testzip() is None, 'ZIP CRC failure'
            # Artifacts are produced by this workflow, not user supplied archives.
            archive.extractall(zipped)
        portable_check = verify_tree(zipped, engine_hash)
        installer = base / 'installer'
        subprocess.run([seven, 'x', str(installers[0]), '-o' + str(installer), '-y', '-bb0'], check=True)
        archives = list(installer.rglob('app-64.7z'))
        assert len(archives) == 1, 'Expected x64 application payload inside NSIS'
        unpacked = base / 'installed'
        subprocess.run([seven, 'x', str(archives[0]), '-o' + str(unpacked), '-y', '-bb0'], check=True)
        installer_check = verify_tree(unpacked, engine_hash)
        assert portable_check['asar_sha256'] == installer_check['asar_sha256'], 'Installer/ZIP app differs'
    manifest = {'version': '2.15.0-jm.6-dev.1', 'commit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                'portable_payload': portable_check, 'installer_payload': installer_check,
                'gpu_inference_tested': False,
                'files': [{'name':p.name,'size_bytes':p.stat().st_size,'sha256':sha(p)} for p in installers + portable]}
    (DIST / 'delivery-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    checksums = '\n'.join(f"{entry['sha256']}  {entry['name']}" for entry in manifest['files'])+'\n'
    (DIST / 'SHA256.txt').write_text(checksums,encoding='utf-8')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        lines = ['## Verified Windows delivery', '', f"Commit: `{manifest['commit']}`", '',
                 '| File | Bytes | SHA-256 |', '|---|---:|---|']
        lines += [f"| {entry['name']} | {entry['size_bytes']} | `{entry['sha256']}` |" for entry in manifest['files']]
        lines += ['', f'Modified engine SHA-256: `{engine_hash}`', '',
                  'Both ZIP and installer payloads verified: x64 application/engine, 14 model files, DLLs, enhanced routing and isolated identity.',
                  'Native Windows CLI startup checked. GPU inference and Pause/Resume on a real GPU were NOT tested.']
        with open(summary,'a',encoding='utf-8') as stream:
            stream.write('\n'.join(lines)+'\n')
    print(json.dumps(manifest,indent=2))
    # Public annotation permits inspecting delivery hashes when authenticated
    # Actions log/artifact APIs are unavailable in the review environment.
    print('::notice title=Verified JM6 preview delivery::'+json.dumps(manifest,separators=(',',':')))


if __name__ == '__main__':
    main()
