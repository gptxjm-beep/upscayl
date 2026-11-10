"""Extract only native binaries from the known jm.2 regression artifact."""
import os
from pathlib import Path
import sys
import zipfile
folder=Path(sys.argv[1])
archive=next(folder.glob('*.zip'))
with zipfile.ZipFile(archive) as stream:
    for name in stream.namelist():
        p=Path(name)
        if str(p.parent).replace('\\','/')=='resources/bin' and p.suffix.lower() in ('.exe','.dll'):
            destination=folder/'engine'/p.name
            destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_bytes(stream.read(name))
engine=folder/'engine/upscayl-jm.exe'
if not engine.is_file():raise SystemExit('Reference engine missing')
with open(os.environ['GITHUB_ENV'],'a',encoding='utf-8') as stream:
    stream.write(f'JM2_REFERENCE_ENGINE={engine}\n')
