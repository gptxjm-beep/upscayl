"""Run one build command and expose a bounded failure tail in GitHub annotations."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import os
import signal
import re

# Windows redirected consoles may default to a legacy codepage.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label',required=True)
parser.add_argument('--timeout-seconds',type=int,default=None)
parser.add_argument('command',nargs=argparse.REMAINDER)
args=parser.parse_args()
command=args.command[1:] if args.command[:1]==['--'] else args.command
if not command: parser.error('command required')
command[0]=shutil.which(command[0]) or command[0]
process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=os.name!='nt')
try:
    captured,_=process.communicate(timeout=args.timeout_seconds)
    returncode=process.returncode
except subprocess.TimeoutExpired as timeout:
    captured=timeout.output or b''
    # Stop only this command's process tree, and retain its partial diagnostics.
    if os.name=='nt':
        subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    else:
        os.killpg(process.pid,signal.SIGKILL)
    try:
        captured,_=process.communicate(timeout=15)
    except subprocess.TimeoutExpired:
        if process.stdout: process.stdout.close()
    returncode=124
    captured+=f'\nCI command exceeded {args.timeout_seconds}s; its process tree was stopped.\n'.encode()
output=captured.decode('utf-8',errors='replace')
logs=Path('.test-artifacts/ci');logs.mkdir(parents=True,exist_ok=True)
name=''.join(c if c.isalnum() else '-' for c in args.label)
(logs/(name+'.log')).write_text(output,encoding='utf-8')
print(output,flush=True)
if args.label == 'software-Vulkan-functional':
    for line in output.splitlines():
        marker='Actual jm.2 reference on software Vulkan: '
        if 'jm.3 inference-gate evidence: ' in line:
            value=line.split('jm.3 inference-gate evidence: ',1)[1].replace('%','%25')
            print(f'::notice title=jm.3 inference gate::{value}',flush=True)
        if marker in line:
            value=line.split(marker,1)[1].replace('%','%25').replace('\r','%0D')
            print(f'::notice title=jm.2 software Vulkan reference::{value}',flush=True)
if returncode:
    lines=output.splitlines()
    markers=[i for i,line in enumerate(lines) if re.search(r'(?:fatal )?error(?:\s+[A-Z]+\d+)?\s*:|CMake Error|undefined reference|\bLNK\d+\b',line,re.I)]
    head='\n'.join('\n'.join(lines[max(0,i-1):i+2]) for i in markers[:8])
    tail=(head[:5000]+'\n... final output ...\n'+output[-1500:]) if head else output[-3500:]
    escaped=tail.replace('%','%25').replace('\r','%0D').replace('\n','%0A')
    print(f'::error title={name}::{escaped}',flush=True)
raise SystemExit(returncode)
