import { useEffect,useState } from 'react';
import { useAtomValue } from 'jotai';
import { batchPromptAtom } from '@/atoms/batch-prompt-atom';
import { jobAtom } from '@/atoms/job-atom';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '../ui/dialog';
import useTwoStageLabels from '../hooks/use-two-stage-labels';
import { ELECTRON_COMMANDS as C } from '@common/electron-commands';
export default function BatchCompletion(){
 const prompt=useAtomValue(batchPromptAtom);
 const job=useAtomValue(jobAtom),labels=useTwoStageLabels();
 const [dismissed,setDismissed]=useState(''),[pending,setPending]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(job?.phase!=='completed-with-errors'){setDismissed('');setError('');}},[job?.id,job?.phase]);
 if(prompt||!job||job.phase!=='completed-with-errors'||dismissed===job.id)return null;
 async function open(command:string){setPending(command);setError('');try{const result=await window.electron.invoke(command,{id:job.id});if(!result?.ok)setError(result?.error||'Could not open this location.');}catch(error){setError(String(error));}finally{setPending('');}}
 return <Dialog open onOpenChange={open=>{if(!open&&!pending)setDismissed(job.id);}}>
  <DialogContent className="z-[100] rounded-3xl border-base-content/10 bg-base-200 text-base-content">
   <DialogTitle>{labels.completedErrors}</DialogTitle>
   <DialogDescription>{labels.summary}</DialogDescription>
   <p><b>{job.completed} / {job.total}</b> · {labels.failed}: <b>{job.failed||0}</b></p>
   {error&&<p role="alert" className="break-words text-sm text-error">{error}</p>}
   <div className="flex flex-col gap-2">
    <button className="btn btn-primary" disabled={!!pending||!job.report} onClick={()=>void open(C.JOB_OPEN_REPORT)}>{labels.openReport}</button>
    <button className="btn btn-outline" disabled={!!pending} onClick={()=>void open(C.JOB_OPEN_OUTPUT)}>{labels.openOutput}</button>
    <button className="btn btn-outline" disabled={!!pending} onClick={()=>void open(C.JOB_OPEN_LOGS)}>{labels.openLogs}</button>
    <button className="btn btn-ghost" disabled={!!pending} onClick={()=>setDismissed(job.id)}>{labels.close}</button>
   </div>
  </DialogContent>
 </Dialog>;
}
