import React, { useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { jobAtom, JobState } from '@/atoms/job-atom';
import { progressAtom, batchModeAtom } from '@/atoms/user-settings-atom';
import { ELECTRON_COMMANDS as C } from '@common/electron-commands';
import useTranslation from '@/components/hooks/use-translation';

export default function JobControls() {
  const [job,setJob]=useAtom(jobAtom);
  const setProgress=useSetAtom(progressAtom);
  const setBatch=useSetAtom(batchModeAtom);
  const t=useTranslation();
  useEffect(() => {
    const update=(_event:any,state:JobState | null) => {
      setJob(state);
      if(state && ['running','pausing'].includes(state.phase)) { setProgress('Batch'); setBatch(true); }
      else setProgress('');
    };
    window.electron.on(C.JOB_STATE,update);
    window.electron.invoke(C.JOB_GET).then(state => update(null,state));
    return () => { window.electron.off(C.JOB_STATE,update); };
  },[]);
  const active=job && ['running','pausing','paused','failed'].includes(job.phase);
  const resume=job && ['paused','failed'].includes(job.phase);
  return <div className="min-w-0 flex-1">
    <button className="btn btn-outline w-full whitespace-nowrap" disabled={!active || job.phase === 'pausing'}
      onClick={() => window.electron.send(resume ? C.JOB_RESUME : C.JOB_PAUSE)}>
      {job?.phase === 'pausing' ? t('SESSION.PAUSING') : resume ? t('SESSION.RESUME')+' ▶' : t('SESSION.PAUSE')+' ⏸'}
    </button>
    {active && <div role="status" aria-live="polite" className="mt-2 break-words text-xs">
      {job.phase === 'pausing' ? t('SESSION.DRAINING') : resume ? t('SESSION.SAVED') : t('SESSION.RUNNING')}
      {' '}{job.completed}/{job.total}
      {job.lastError && <p role="alert" className="mt-1 text-error">{job.lastError}</p>}
      <button className="btn btn-ghost btn-sm mt-1 w-full" onClick={() => window.electron.send(C.STOP)}>{t('SESSION.CANCEL')}</button>
    </div>}
  </div>;
}
