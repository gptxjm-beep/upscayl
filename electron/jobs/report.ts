import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { modelDisplayName } from '../../common/model-metadata';
import type { BatchFailure } from '../../common/types/batch-ui';
export type ReportJob={id:string;source:string;output:string;phase:string;settings:{model:string;useTwoModels?:boolean;secondModel?:string;singleImage?:string};items:{source:string;state:string;failure?:BatchFailure;error?:string}[];failure?:BatchFailure;report?:string;reportHash?:string};
const clean=(value:unknown)=>String(value??'').replace(/[\r\n\x00-\x08]/g,' ').slice(0,500);
const digest=(data:Buffer|string)=>crypto.createHash('sha256').update(data).digest('hex');
export function writeErrorReport(s:ReportJob){
 const failed=s.items.filter(item=>item.state==='failed'),completed=s.items.filter(item=>item.state==='completed').length;
 const lines=[`Date (UTC): ${new Date().toISOString()}`,`Job: ${clean(path.basename(s.settings.singleImage||s.source))}`,`Job ID: ${s.id}`,`Status: ${s.phase==='completed-with-errors'?'Completed with Errors':s.phase}`,`Models: ${clean(modelDisplayName(s.settings.model))}${s.settings.useTwoModels?' → '+clean(modelDisplayName(s.settings.secondModel||'')):''}`,`Total images: ${s.items.length}`,`Successful: ${completed}`,`Failed: ${failed.length}`,`Not completed: ${s.items.length-completed-failed.length}`,''];
 if(s.failure)lines.push('Job error: '+clean(s.failure.reason)+(s.failure.code?' (code '+clean(s.failure.code)+')':''),'');
 if(failed.length)lines.push('Failed images:');
 for(const item of failed){const f=item.failure;lines.push(`${clean(path.basename(item.source))} | stage: ${clean(f?.stage||'validation')} | ${clean(f?.reason||item.error||'Processing failed')}${f?.code?' | code: '+clean(f.code):''}`);}
 if(!failed.length)lines.push('No failed images.');
 lines.push('','Detailed technical diagnostics are kept in the application Logs folder.');
 const text='\ufeff'+lines.join('\r\n')+'\r\n',temporary=path.join(s.output,'.upscayl-report-'+s.id+'.new');
 fs.rmSync(temporary,{force:true});
 const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 let file=path.join(s.output,'upscayl_batch_report.txt');
 try{
  // Replace only this job's unchanged previous report. Preserve an unrelated
  // user-created or edited report by selecting a fresh name instead.
  let previousOwned=false,replaced=false;
  if(s.report&&path.dirname(s.report)===s.output&&/^upscayl_batch_report(?:_\d+)?\.txt$/.test(path.basename(s.report)))try{previousOwned=digest(fs.readFileSync(s.report))===s.reportHash;}catch{}
  if(previousOwned)try{file=s.report!;fs.renameSync(temporary,file);replaced=true;}catch(error){if(!['EACCES','EPERM','EBUSY'].includes((error as NodeJS.ErrnoException).code||''))throw error;}
  if(!replaced){file=path.join(s.output,'upscayl_batch_report.txt');let index=2;while(true){try{fs.linkSync(temporary,file);fs.unlinkSync(temporary);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;file=path.join(s.output,'upscayl_batch_report_'+index+++'.txt');}}}
  s.report=file;s.reportHash=digest(text);
  try{const folder=fs.openSync(s.output,'r');try{fs.fsyncSync(folder);}finally{fs.closeSync(folder);}}catch{}
 }finally{fs.rmSync(temporary,{force:true});}
 return file;
}
export function isJobFailure(error:unknown,stage?:string,code?:string){
 if(['source','decode','dimensions'].includes(stage||''))return false;
 const text=String(error)+' '+String(code||'');
 return ['model','initialization','device','disk','job','inference-global','encode-global','validation-global','destination'].includes(stage||'')||/\b(ENOSPC|EDQUOT|EACCES|EPERM|EROFS|EIO|ERROR_DISK_FULL)\b|0x80070070|0x80030070|0x80070027|device lost|VK_ERROR_DEVICE_LOST|VK_ERROR_OUT_OF_DEVICE_MEMORY/i.test(text);
}
