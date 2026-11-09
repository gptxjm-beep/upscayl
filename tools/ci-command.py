"""Run one build command and expose a bounded failure tail in GitHub annotations."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys

# Windows redirected consoles may default to a legacy codepage.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label',required=True)
parser.add_argument('command',nargs=argparse.REMAINDER)
args=parser.parse_args()
command=args.command[1:] if args.command[:1]==['--'] else args.command
if not command: parser.error('command required')
command[0]=shutil.which(command[0]) or command[0]
result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
output=result.stdout.decode('utf-8',errors='replace')
logs=Path('.test-artifacts/ci');logs.mkdir(parents=True,exist_ok=True)
name=''.join(c if c.isalnum() else '-' for c in args.label)
(logs/(name+'.log')).write_text(output,encoding='utf-8')
print(output,flush=True)
if args.label == 'software-Vulkan-functional':
    for line in output.splitlines():
        marker='Actual jm.1 reference on software Vulkan: '
        if marker in line:
            value=line.split(marker,1)[1].replace('%','%25').replace('\r','%0D')
            print(f'::notice title=jm.1 software Vulkan reference::{value}',flush=True)
if result.returncode:
    tail=output[-3500:]
    escaped=tail.replace('%','%25').replace('\r','%0D').replace('\n','%0A')
    print(f'::error title={name}::{escaped}',flush=True)
raise SystemExit(result.returncode)
