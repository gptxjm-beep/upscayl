import { useEffect, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { jobAtom, JobState } from '@/atoms/job-atom';
import { batchModeAtom, progressAtom } from '@/atoms/user-settings-atom';
import { ELECTRON_COMMANDS as C } from '@common/electron-commands';
import useTranslation from './use-translation';

// Subscribe at page level, so changing tabs never removes job state listeners.
export default function useBatchJob(setImagePath?:(value:string)=>void) {
  const setJob=useSetAtom(jobAtom),setProgress=useSetAtom(progressAtom),setBatch=useSetAtom(batchModeAtom);
  const t=useTranslation();
  const owned=useRef(false);
  useEffect(()=>{
    let mounted=true,received=false;
    const update=(_event:unknown,state:JobState|null)=>{
      if(!mounted)return;if(_event)received=true;
      setJob(state);
      if(state && ['preparing','resuming','recovering','running','pausing','paused','failed'].includes(state.phase)) {
        owned.current=true;
        setBatch(state.kind!=="single");if(state.kind==="single"&&state.settings?.singleImage)setImagePath?.(state.settings.singleImage);setProgress(t('APP.PROGRESS.WAIT_TITLE'));
      } else if(owned.current||_event){setProgress('');owned.current=false;}
    };
    window.electron.on(C.JOB_STATE,update);
    window.electron.invoke(C.JOB_GET).then(state=>{if(!received)update(null,state);}).catch(()=>{});
    return ()=>{mounted=false;window.electron.off(C.JOB_STATE,update);};
  },[setJob,setProgress,setBatch,t,setImagePath]);
}
