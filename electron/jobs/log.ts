import fs from 'fs';
import path from 'path';
const LIMIT=256*1024, KEEP_JOBS=8;
function trim(file:string){
 const size=fs.statSync(file).size;if(size<=LIMIT)return;
 const data=Buffer.alloc(LIMIT),fd=fs.openSync(file,'r');
 try{fs.readSync(fd,data,0,LIMIT,size-LIMIT);}finally{fs.closeSync(fd);}
 const boundary=data.indexOf(10);fs.writeFileSync(file,boundary<0?Buffer.alloc(0):data.subarray(boundary+1));
}
// Owned log files only; snapshots, outputs and unrelated Electron logs are never pruned.
export function writeBatchEvent(directory:string,job:string|undefined,kind:string,data:unknown){
 fs.mkdirSync(directory,{recursive:true});
 const file=path.join(directory,job?'batch-'+job+'.log':'batch-events.log'),fresh=!fs.existsSync(file);
 let event={at:new Date().toISOString(),job,kind,data};
 let line=JSON.stringify(event,(_key,value)=>typeof value==='string'?value.slice(0,6000):value)+'\n';
 if(Buffer.byteLength(line)>16384)line=JSON.stringify({...event,data:{truncated:true,details:line.slice(0,12000)}})+'\n';
 if(!fresh&&fs.statSync(file).size+Buffer.byteLength(line)>LIMIT){
  fs.rmSync(file+'.1',{force:true});trim(file);fs.renameSync(file,file+'.1');
 }
 fs.appendFileSync(file,line,'utf8');
 if(fresh&&job)pruneBatchLogs(directory,file);
}
export function pruneBatchLogs(directory:string,current?:string){
 if(!fs.existsSync(directory))return;
 const groups=new Map<string,{time:number;files:string[]}>();
 for(const name of fs.readdirSync(directory)){
  const match=/^(batch-[a-f0-9-]+\.log)(?:\.1)?$/i.exec(name);
  if(!match&&name!=='batch-events.log'&&name!=='batch-events.log.1')continue;
  const file=path.join(directory,name),stat=fs.lstatSync(file);if(!stat.isFile())continue;
  trim(file);if(!match)continue;
  const group=groups.get(match[1])||{time:0,files:[]};group.time=Math.max(group.time,stat.mtimeMs);group.files.push(file);groups.set(match[1],group);
 }
 const recent=[...groups.values()].sort((a,b)=>(!!current&&b.files.includes(current)?1:0)-(!!current&&a.files.includes(current)?1:0)||b.time-a.time);
 for(const group of recent.slice(KEEP_JOBS))for(const file of group.files)fs.rmSync(file,{force:true});
}
