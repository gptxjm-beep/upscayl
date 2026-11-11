import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { atomicJSON, readJSON } from './store';
import type { RecoveryIssue } from '../../common/types/batch-ui';

// Notices are bound to the exact pointer/journal bytes. A repaired journal is
// discovered again; archiving a notice never moves or deletes recovery data.
export function recoveryIssue(registry:string,name:string,error:unknown):RecoveryIssue|undefined {
 const pointer=path.join(registry,name),sessionId=path.basename(name,'.json');
 let journal:string|undefined,source:string|undefined;
 try{
  const link=readJSON<{file:string;source?:string}>(pointer);
  if(typeof link.file==='string'&&path.isAbsolute(link.file)&&path.basename(link.file)==='state.json'&&(path.basename(path.dirname(link.file))==='.upscayl-session'||path.dirname(link.file)===path.join(registry,sessionId))){journal=link.file;source=typeof link.source==='string'?link.source:undefined;}
 }catch{}
 const fingerprint=crypto.createHash('sha256');let present=0;
 for(const file of [pointer,...journal?[journal]:[]])for(const suffix of ['', '.bak','.new','.bak.new']){
  fingerprint.update(file+suffix+'\0');try{const data=fs.readFileSync(file+suffix);fingerprint.update(data);if(file===journal&&['','.bak'].includes(suffix))present++;}catch(e){fingerprint.update((e as NodeJS.ErrnoException).code||'unreadable');}
 }
 const id=fingerprint.digest('hex');
 try{const archived=readJSON<{id:string;archived:boolean}>(path.join(registry,'recovery-notices',id+'.json'));if(archived.id===id&&archived.archived)return undefined;}catch{}
 return {id,sessionId,pointer,journal,source,reason:journal&&!present?'missing':'unreadable',details:String(error).slice(0,500)};
}

export function archiveRecoveryIssue(registry:string,issue:RecoveryIssue){
 if(!/^[a-f0-9]{64}$/.test(issue.id)||path.dirname(issue.pointer)!==registry)throw Error('Invalid recovery notice');
 const current=recoveryIssue(registry,path.basename(issue.pointer),issue.details);
 if(!current||current.id!==issue.id)throw Error('Recovery files changed. Reopen the recovery notice before archiving it.');
 const directory=path.join(registry,'recovery-archive',issue.id);fs.mkdirSync(directory,{recursive:true});
 for(const [index,file] of [issue.pointer,...issue.journal?[issue.journal]:[]].entries())for(const suffix of ['', '.bak','.new','.bak.new']){
  const source=file+suffix,target=path.join(directory,String(index)+'-'+path.basename(source));
  if(!fs.existsSync(source)||fs.existsSync(target))continue;
  fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);const fd=fs.openSync(target,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 atomicJSON(path.join(directory,'notice.json'),{...issue,archivedAt:new Date().toISOString()});
 atomicJSON(path.join(registry,'recovery-notices',issue.id+'.json'),{id:issue.id,archived:true});
}
