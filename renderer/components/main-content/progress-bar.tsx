import { jobAtom } from "@/atoms/job-atom";
import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from 'lucide-react';
import BatchError from './batch-error';
import UpscaylSVGLogo from "@/components/icons/upscayl-logo-svg";
import { useAtomValue } from "jotai";
import { translationAtom } from "@/atoms/translations-atom";
import { ELECTRON_COMMANDS } from "@common/electron-commands";
import useLogger from "../hooks/use-logger";

function ProgressBar({
  progress,
  doubleUpscaylCounter,
  batchMode,
  resetImagePaths,
}: {
  progress: string;
  doubleUpscaylCounter: number;
  batchMode: boolean;
  resetImagePaths: () => void;
}) {
  const job = useAtomValue(jobAtom);
  const [batchProgress, setBatchProgress] = React.useState(0);
  const t = useAtomValue(translationAtom);
  const logit = useLogger();
  const clicked=useRef(false);
  const [pending,setPending]=useState<'pause'|'resume'|null>(null);
  const [actionError,setActionError]=useState('');

  useEffect(() => {
    const progressString = progress.trim().replace(/\n/g, "");
    // Remove trailing and leading spaces
    if (progressString.includes("Successful")) {
      setBatchProgress((prev) => prev + 1);
    }
  }, [progress]);

  const stopHandler = () => {
    window.electron.send(ELECTRON_COMMANDS.STOP,(batchMode||batchJob)?{batch:true,batchSessionId:batchJob?.id}:undefined);
    logit("🛑 Stopping Upscayl");
  };

  // const progressStyle = useMemo(() => {
  //   if (progress.includes("%")) {
  //     return {
  //       "--value": parseFloat(progress.replace("%", "")),
  //     };
  //   } else if (progress.includes("Success")) {
  //     return {
  //       "--value": 100,
  //     };
  //   }
  //   return {
  //     "--value": 0,
  //   };
  // }, [progress]);

  const batchJob = (batchMode||job?.kind==="single") && job && ["preparing","resuming","recovering","running", "pausing", "paused", "failed"].includes(job.phase) ? job : null;
  const phase = batchJob?.phase;
  const isPaused=phase === 'paused' && batchJob?.engineStopped === true;
  const isPausing=phase === 'pausing' || phase === 'paused' && !isPaused;
  const failed=phase === 'failed';
  const transition=phase==='preparing'||phase==='resuming'||phase==='recovering';
  const transitionText=t(phase==='recovering'?'BATCH_UI.RECOVERING':phase==='preparing'?'BATCH_UI.PREPARING':'BATCH_UI.RESUMING');
  const displayProgress=pending==='resume'?t('BATCH_UI.RESUMING'):pending==='pause'||isPausing?t('SESSION.PAUSING'):transition?transitionText:isPaused?t('SESSION.PAUSED'):failed?t('SESSION.FAILED'):progress;
  async function processingAction(){
    if(clicked.current||transition||isPausing||failed)return;
    clicked.current=true;const action=isPaused?'resume':'pause';setPending(action);setActionError('');
    try{const result=await window.electron.invoke(action==='resume'?ELECTRON_COMMANDS.JOB_RESUME:ELECTRON_COMMANDS.JOB_PAUSE);if(!result?.ok)setActionError(result?.error||t('BATCH_UI.ACTION_FAILED'));}
    catch{setActionError(t('BATCH_UI.ACTION_FAILED'));}
    finally{clicked.current=false;setPending(null);}
  }

  return (
    <div className="absolute z-50 flex h-full w-full flex-col items-center justify-center bg-base-300/50 backdrop-blur-lg">
      <div className="flex flex-col items-center gap-2 rounded-btn bg-base-100/50 p-4 backdrop-blur-lg">
        <UpscaylSVGLogo className={`${isPaused || failed ? "" : "spinner"} h-12 w-12`} />

        <p className="rounded-full px-2 pb-2 font-bold">
          {batchMode &&
            `${t("APP.PROGRESS_BAR.BATCH_UPSCAYL_IN_PROGRESS_TITLE")} ${batchJob ? batchJob.completed : batchProgress}`}
        </p>

        <div className="flex flex-col items-center gap-1">
          {progress !== "Hold on..." ? (
            <p className="text-sm font-bold">
              {displayProgress}
              {!batchMode &&
                doubleUpscaylCounter > 0 &&
                "\nPass " + doubleUpscaylCounter}
            </p>
          ) : (
            <p className="text-sm font-bold">{displayProgress}</p>
          )}

          <p className={`${isPaused||failed?'':'animate-pulse'} max-w-lg rounded-full px-2 pb-3 text-center text-xs font-medium text-neutral-content/50`}>
            {pending==='resume'||transition?transitionText:isPausing||pending==='pause'?t('SESSION.DRAINING'):isPaused?t('SESSION.SAVED'):failed?t('BATCH_UI.LOG_HELP'):t('APP.PROGRESS_BAR.IN_PROGRESS_TITLE')}
          </p>
        </div>

        {failed && <BatchError job={batchJob}/>}
        {actionError&&<p role="alert" className="max-w-sm break-words text-sm text-error">{actionError.slice(0,300)}</p>}
        <div className="flex flex-wrap justify-center gap-2">
        <button onClick={stopHandler} className="btn btn-outline">
          {t("APP.PROGRESS_BAR.STOP_BUTTON_TITLE")}
        </button>
        {batchJob && <button className="btn btn-outline" disabled={!!pending||transition||isPausing||failed} onClick={()=>void processingAction()}>
          {(pending||transition||isPausing)&&<Loader2 aria-hidden className="h-4 w-4 animate-spin"/>}
          {pending==='resume'?t('BATCH_UI.RESUMING'):pending==='pause'||isPausing?t('SESSION.PAUSING'):transition?transitionText:isPaused?t('SESSION.RESUME'):t('SESSION.PAUSE')}
        </button>}
        </div>
      </div>
    </div>
  );
}

export default ProgressBar;
