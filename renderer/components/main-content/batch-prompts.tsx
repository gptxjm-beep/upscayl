import { useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { batchPromptAtom } from '@/atoms/batch-prompt-atom';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '../ui/dialog';
import UpscaylSVGLogo from '../icons/upscayl-logo-svg';
import { Folder,Loader2,Play,RotateCcw } from 'lucide-react';
import { ELECTRON_COMMANDS as C } from '@common/electron-commands';
import type { BatchPrompt,PromptChoice } from '@common/types/batch-ui';
import type { BatchUpscaylPayload } from '@common/types/types';
import useTranslation from '../hooks/use-translation';
const folderName=(source:string)=>source.replace(/[\\/]+$/,'').split(/[\\/]/).pop()||source;
const modelName=(id:string)=>({'upscayl-standard-4x':'Upscayl Standard','upscayl-lite-4x':'Upscayl Lite','high-fidelity-4x':'High Fidelity','digital-art-4x':'Digital Art','ultramix-balanced-4x':'Ultramix Balanced','ultrasharp-4x':'Ultrasharp','remacri-4x':'Remacri'}[id]||id);
function Settings({value,title}:{value:BatchUpscaylPayload;title:string}){
 return <div className="min-w-0 rounded-2xl border border-base-content/10 bg-base-100/40 p-4"><p className="mb-2 text-xs font-medium text-base-content/60">{title}</p><p className="break-words font-semibold">{modelName(value.model)}</p><p className="mt-1 text-sm text-base-content/70">{value.useCustomWidth?`${value.customWidth}px`:`${value.scale}×`} · {value.saveImageAs.toUpperCase()}</p></div>;
}
function PromptCard({prompt}:{prompt:BatchPrompt}){
 const t=useTranslation(),clicked=useRef(false);
 const [pending,setPending]=useState<PromptChoice|null>(null),[error,setError]=useState('');
 const stop=prompt.kind==='stop',startup=prompt.kind==='startup',session=prompt.session;
 const busy=!!pending||prompt.busy;
 async function act(choice:PromptChoice){
  if(clicked.current||prompt.busy)return;clicked.current=true;setPending(choice);setError('');
  try{const result=await window.electron.invoke(C.JOB_PROMPT_ACTION,{token:prompt.token,choice});if(!result?.ok)setError(result?.error||t('BATCH_UI.ACTION_FAILED'));}
  catch{setError(t('BATCH_UI.ACTION_FAILED'));}
  finally{clicked.current=false;setPending(null);}
 }
 const label=(choice:PromptChoice,text:string)=>pending===choice?<><Loader2 aria-hidden className="h-4 w-4 animate-spin"/>{t(choice==='resume'?'BATCH_UI.RECOVERING':choice==='fresh'?'BATCH_UI.PREPARING':choice==='stop'?'BATCH_UI.STOPPING':'BATCH_UI.WAIT')}</>:text;
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)void act('dismiss');}}>
  <DialogContent hideCloseButton className="z-[100] max-h-[90vh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-3xl border-base-content/10 bg-base-200 p-6 text-base-content shadow-2xl sm:rounded-3xl"
   onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>e.preventDefault()}>
   <div className="flex items-center gap-3"><UpscaylSVGLogo className="h-10 w-10 shrink-0"/><div className="min-w-0"><DialogTitle className="text-xl font-bold">{t(stop?'BATCH_UI.STOP_TITLE':startup?'BATCH_UI.STARTUP_TITLE':'BATCH_UI.FOLDER_TITLE')}</DialogTitle><DialogDescription className="mt-1 text-sm text-base-content/70">{t(stop?'BATCH_UI.STOP_DESCRIPTION':startup?'BATCH_UI.STARTUP_DESCRIPTION':'BATCH_UI.FOLDER_DESCRIPTION')}</DialogDescription></div></div>
   {!stop&&session&&<>
    <div className="rounded-2xl border border-base-content/10 bg-base-100/30 p-4">
     <div className="mb-3 flex min-w-0 items-center gap-2"><Folder aria-hidden className="h-5 w-5 shrink-0 text-primary"/><p className="truncate text-base font-semibold" title={session.source}>{folderName(session.source)}</p></div>
     <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><p><b dir="ltr">{session.completed} / {session.total}</b> {t('BATCH_UI.COMPLETED')}</p><p className="text-base-content/60">{Math.max(0,session.total-session.completed)} {t('BATCH_UI.REMAINING')}</p></div>
     <progress aria-label={t('BATCH_UI.SAVED_PROGRESS')} className="progress progress-primary h-2 w-full" max={Math.max(1,session.total)} value={session.completed}/>
     <p className="mt-3 break-all text-xs text-base-content/50" title={session.output}>{session.output}</p>
    </div>
    <div className={`grid gap-3 ${startup?'':'sm:grid-cols-2'}`}>
     {!startup&&prompt.currentSettings&&<Settings title={t('BATCH_UI.CURRENT_SETTINGS')} value={prompt.currentSettings}/>}
     <Settings title={t('BATCH_UI.PREVIOUS_SETTINGS')} value={session.settings}/>
    </div>
   </>}
   {(error||prompt.error)&&<p role="alert" className="break-words rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error||prompt.error}</p>}
   {busy&&<p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-base-content/70"><Loader2 aria-hidden className="h-4 w-4 animate-spin"/>{t(stop?'BATCH_UI.STOPPING':pending==='fresh'?'BATCH_UI.PREPARING':'BATCH_UI.RECOVERING')}</p>}
   <div className={`grid gap-2 ${startup||stop?'sm:grid-cols-2':''}`}>
    {!stop&&<button className="btn btn-primary h-auto min-h-12 py-3" disabled={busy} onClick={()=>void act('resume')}><Play aria-hidden className="h-4 w-4"/>{label('resume',t(startup?'BATCH_UI.RESUME_PROCESSING':'BATCH_UI.RESUME_PREVIOUS'))}</button>}
    {!startup&&!stop&&<button className="btn btn-outline h-auto min-h-12 flex-col gap-1 py-3" disabled={busy||!prompt.currentSettings} onClick={()=>void act('fresh')}><span className="flex items-center justify-center gap-2"><RotateCcw aria-hidden className="h-4 w-4"/>{label('fresh',t('BATCH_UI.START_FRESH'))}</span><span className="text-xs font-normal opacity-70">{t('BATCH_UI.KEEP_RESULTS')}</span></button>}
    <button autoFocus={stop} className="btn btn-outline" disabled={busy} onClick={()=>void act('dismiss')}>{t(stop?'BATCH_UI.GO_BACK':startup?'BATCH_UI.NOT_NOW':'BATCH_UI.CANCEL')}</button>
    {stop&&<button className="btn btn-error" disabled={busy} onClick={()=>void act('stop')}>{label('stop',t('BATCH_UI.STOP_TASK'))}</button>}
   </div>
  </DialogContent>
 </Dialog>;
}
export default function BatchPromptDialogs(){
 const [prompt,setPrompt]=useAtom(batchPromptAtom);
 useEffect(()=>{
  let mounted=true,received=false;
  const update=(_event:unknown,value:BatchPrompt|null)=>{received=true;if(mounted)setPrompt(value);};
  window.electron.on(C.JOB_PROMPT,update);
  window.electron.invoke(C.JOB_PROMPT_GET).then(value=>{if(mounted&&!received)setPrompt(value);}).catch(()=>{});
  return()=>{mounted=false;window.electron.off(C.JOB_PROMPT,update);};
 },[setPrompt]);
 return prompt?<PromptCard key={prompt.token} prompt={prompt}/>:null;
}
