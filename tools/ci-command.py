"""Run one build command and expose a bounded failure tail in GitHub annotations."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label',required=True)
parser.add_argument('command',nargs=argparse.REMAINDER)
args=parser.parse_args()
command=args.command[1:] if args.command[:1]==['--'] else args.command
if not command: parser.error('command required')
command[0]=shutil.which(command[0]) or command[0]
result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
output=result.stdout.decode('utf-8',errors='replace')
print(output,flush=True)
logs=Path('.test-artifacts/ci');logs.mkdir(parents=True,exist_ok=True)
name=''.join(c if c.isalnum() else '-' for c in args.label)
(logs/(name+'.log')).write_text(output,encoding='utf-8')
if result.returncode:
    tail=output[-3500:]
    escaped=tail.replace('%','%25').replace('\r','%0D').replace('\n','%0A')
    print(f'::error title={name}::{escaped}',flush=True)
raise SystemExit(result.returncode)
