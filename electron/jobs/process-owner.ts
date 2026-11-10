import fs from 'fs';
import { execFileSync } from 'child_process';

// A PID alone is not identity: it can be reused after a crash/reboot. Only
// block recovery when that process still names this session's control path.
export function ownsEngine(pid:number, control:string):boolean {
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid saved engine PID');
  try {process.kill(pid,0);} catch(error) {
    if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;
  }
  if(process.platform==='linux') {
    try {
      const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8');
      if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z'))return false;
      return fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').includes(control);
    } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  }
  if(process.platform==='win32') {
    const script=`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){if([string]::IsNullOrEmpty($p.CommandLine)){throw 'Cannot verify saved engine process ownership'}; $p.CommandLine}`;
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000});
    return output.includes(control);
  }
  const output=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8',timeout:10000});
  return output.includes(control);
}
