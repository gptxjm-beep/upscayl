import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { jobAtom, JobState } from '@/atoms/job-atom';
import { batchModeAtom, progressAtom } from '@/atoms/user-settings-atom';
import { ELECTRON_COMMANDS as C } from '@common/electron-commands';
import useTranslation from './use-translation';

// Subscribe at page level, so changing tabs never removes job state listeners.
export default function useBatchJob() {
  const setJob=useSetAtom(jobAtom),setProgress=useSetAtom(progressAtom),setBatch=useSetAtom(batchModeAtom);
  const t=useTranslation();
  useEffect(()=>{
    const update=(_event:unknown,state:JobState|null)=>{
      setJob(state);
      if(state && ['running','pausing','paused','failed'].includes(state.phase)) {
        setBatch(true);setProgress(t('APP.PROGRESS.WAIT_TITLE'));
      } else setProgress('');
    };
    window.electron.on(C.JOB_STATE,update);
    window.electron.invoke(C.JOB_GET).then(state=>update(null,state));
    return ()=>{window.electron.off(C.JOB_STATE,update);};
  },[setJob,setProgress,setBatch,t]);
}
