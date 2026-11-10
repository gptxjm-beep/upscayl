import { useState } from 'react';
import { FolderOpen,Loader2 } from 'lucide-react';
import type { JobState } from '@/atoms/job-atom';
import { ELECTRON_COMMANDS as C } from '@common/electron-commands';
import useTranslation from '../hooks/use-translation';
export default function BatchError({job}:{job:JobState}){
 const t=useTranslation(),[opening,setOpening]=useState(false),[openError,setOpenError]=useState('');
 const details=job.failure?.details||job.lastError||'';
 const image=job.failure?.image||/Image (.*?) failed during/i.exec(details)?.[1];
 const reason=job.failure?.reason||(/88982f51/i.test(details)?'The image encoder rejected the output dimensions.':t('BATCH_UI.ERROR_REASON'));
 async function open(){if(opening)return;setOpening(true);try{const result=await window.electron.invoke(C.JOB_OPEN_LOGS);if(!result?.ok)setOpenError(t('BATCH_UI.LOGS_UNAVAILABLE'));}catch{setOpenError(t('BATCH_UI.LOGS_UNAVAILABLE'));}finally{setOpening(false);}}
 return <div className="my-2 w-full max-w-lg rounded-2xl border border-error/20 bg-error/5 p-4 text-left">
  <div role="alert" className="space-y-2 text-sm">{image&&<p className="break-words font-semibold text-error">{image}</p>}<p className="break-words text-base-content/80">{reason}</p></div>
  <button className="btn btn-ghost btn-sm mt-3" disabled={opening} onClick={()=>void open()}>{opening?<Loader2 aria-hidden className="h-4 w-4 animate-spin"/>:<FolderOpen aria-hidden className="h-4 w-4"/>}{t(opening?'BATCH_UI.OPENING_LOGS':'BATCH_UI.OPEN_LOGS')}</button>
  {openError&&<p role="alert" className="mt-2 break-all text-xs">{openError} {job.logsPath||'%APPDATA%\\Upscayl Enhanced\\logs'}</p>}
  {details&&<details className="mt-2"><summary className="cursor-pointer text-xs text-base-content/60">{t('BATCH_UI.TECHNICAL_DETAILS')}</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-base-300/40 p-3 text-xs text-base-content/70">{details.slice(-6000)}</pre></details>}
 </div>;
}
