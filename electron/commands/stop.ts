import { batchManager, requestBatchStop } from "../jobs/integration";
import { getMainWindow } from "../main-window";
import { childProcesses, setStopped } from "../utils/config-variables";
import logit from "../utils/logit";
import { ELECTRON_COMMANDS as C } from '../../common/electron-commands';

const stop = async (event, payload) => {
  const mainWindow = getMainWindow();

  const manager=batchManager();
  if(payload?.batchSessionId && payload.batchSessionId!==manager.session?.id)return;
  const batchRequest=payload?.batch || payload?.batchSessionId;
  if(batchRequest&&!manager.hasActiveBatch())return;
  if(batchRequest) {
    try {if(await requestBatchStop())mainWindow?.setProgressBar(-1);}
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
