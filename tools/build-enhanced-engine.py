"""Fetch pinned build dependencies and compile the vendored JM engine (no model changes)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
vendor = root / 'vendor/upscayl-ncnn'
origin = json.loads((vendor / 'ORIGIN.json').read_text())

def run(*args, cwd=None):
    subprocess.run(list(map(str,args)), cwd=cwd, check=True)

for name, url in [('ncnn','https://github.com/Tencent/ncnn.git'),('libwebp','https://github.com/webmproject/libwebp.git'),('zlib','https://github.com/madler/zlib.git'),('libpng','https://github.com/pnggroup/libpng.git')]:
    target=vendor / 'src' / name
    if not (target / '.git').exists():
        run('git','clone','--filter=blob:none',url,target)
    # Never reset a dependency that has local changes.
    if subprocess.check_output(['git','status','--porcelain'],cwd=target).strip():
        raise SystemExit(f'Dirty dependency checkout: {target}')
    run('git','fetch','origin',origin[name],cwd=target)
    run('git','checkout','--detach',origin[name],cwd=target)
    run('git','-c','url.https://github.com/.insteadOf=git@github.com:',
        'submodule','update','--init','--recursive',cwd=target)

build=vendor / 'build'
run('cmake','-S',vendor / 'src','-B',build,'-DCMAKE_BUILD_TYPE=Release','-DWITH_LAYER_reorg=ON','-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF',*sys.argv[1:])
# Fail codec compilation before unrelated NCNN warnings can bury the first error.
run('cmake','--build',build,'--config','Release','--target','jm-png-test','--parallel','2')
run('cmake','--build',build,'--config','Release','--parallel','2')
exe='upscayl-bin.exe' if sys.platform=='win32' else 'upscayl-bin'
candidates=[build / 'Release' / exe,build / exe]
binary=next((p for p in candidates if p.is_file()),None)
if not binary: raise SystemExit('CMake did not produce engine')
platform='win' if sys.platform=='win32' else 'mac' if sys.platform=='darwin' else 'linux'
destination=root / 'resources' / platform / 'bin' / ('upscayl-jm.exe' if sys.platform=='win32' else 'upscayl-jm')
shutil.copy2(binary,destination)
print(destination)
