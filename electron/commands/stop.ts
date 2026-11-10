import { batchManager } from "../jobs/integration";
import { getMainWindow } from "../main-window";
import { childProcesses, setStopped } from "../utils/config-variables";
import logit from "../utils/logit";
import { dialog } from "electron";
import { ELECTRON_COMMANDS as C } from '../../common/electron-commands';

const stop = async (event, payload) => {
  const mainWindow = getMainWindow();

  const manager=batchManager();
  if(payload?.batchSessionId && payload.batchSessionId!==manager.session?.id)return;
  if(payload?.batchSessionId && manager.session && ['running','pausing','paused','failed'].includes(manager.session.phase)) {
    const options={type:'warning' as const,title:'Cancel Batch Processing?',
      message:'Are you sure you want to permanently cancel this batch?',
      detail:'Your completed images will be kept, but the temporary session and recovery files will be deleted. You will not be able to resume this batch later.',
      buttons:['Go Back','Yes, Cancel Batch'],defaultId:0,cancelId:0,noLink:true};
    const choice=mainWindow?await dialog.showMessageBox(mainWindow,options):await dialog.showMessageBox(options);
    if(choice.response!==1)return;
    try {await manager.cancel();mainWindow?.setProgressBar(-1);}
    catch(error){logit('Batch cancellation failed',String(error));mainWindow?.webContents.send(C.UPSCAYL_WARNING,String(error));}
    return;
  }
  setStopped(true);
  mainWindow && mainWindow.setProgressBar(-1);
  childProcesses.forEach((child) => {
    logit("🛑 Stopping Upscaling Process", child.process.pid);
    child.kill();
  });
};

export default stop;
