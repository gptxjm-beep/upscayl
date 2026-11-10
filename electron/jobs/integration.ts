import { app, dialog, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import isDev from 'electron-is-dev';
import { BatchManager } from './manager';
import { modelsPath } from '../utils/get-resource-paths';
import { savedCustomModelsPath } from '../utils/config-variables';
import { MODELS } from '../../common/models-list';
import { copyMetadata } from '../utils/copy-metadata';
import { getMainWindow } from '../main-window';
import { ELECTRON_COMMANDS as C } from '../../common/electron-commands';
import { BatchUpscaylPayload } from '../../common/types/types';

let manager: BatchManager;
let recoveryPrompt=false;
const send=(command:string,data:any) => { const w=getMainWindow(); if(w && !w.isDestroyed()) w.webContents.send(command,data); };
const problem=(e:any) => send(C.UPSCAYL_WARNING,String(e));
export function batchManager() {
  if(!manager) {
    manager=new BatchManager(path.join(app.getPath('userData'),'enhanced-sessions'),copyMetadata);
    manager.on('state', state => {
      send(C.JOB_STATE,state);
      if(state?.phase === 'completed') send(C.FOLDER_UPSCAYL_DONE,state.output);
    });
    manager.on('problem',problem);
    // Keep textual diagnostics separate from legacy error parsing in renderer.
    manager.on('log',data => send(C.LOG,data));
  }
  return manager;
}
function currentBatchEngine() {
  return isDev ? path.join(app.getAppPath(),'resources',process.platform === 'win32' ? 'win':process.platform === 'darwin' ? 'mac':'linux','bin',process.platform === 'win32' ? 'upscayl-jm.exe':'upscayl-jm')
    : path.join(path.dirname(app.getAppPath()),'bin',process.platform === 'win32' ? 'upscayl-jm.exe':'upscayl-jm');
}
export async function startBatch(_event:any,payload:BatchUpscaylPayload) {
  try {
    const engine=currentBatchEngine();
    if(!fs.existsSync(engine)) throw new Error('Enhanced batch engine is missing. Build vendor/upscayl-ncnn before using batch pause/recovery. Original Single and Double remain available.');
    await batchManager().create(payload,payload.model in MODELS ? modelsPath : (savedCustomModelsPath || modelsPath),engine);
  } catch(e) { problem(e); send(C.JOB_STATE,batchManager().snapshot()); }
}
export async function offerRecovery(source?:string) {
  if(recoveryPrompt)return;
  recoveryPrompt=true;
  try {
    const active=batchManager().session;
    if(active && ['running','pausing','paused'].includes(active.phase)) return;
    for(const session of batchManager().discover(source)) {
      const window=getMainWindow(); if(!window) return;
      const choice=await dialog.showMessageBox(window,{
        type:'question',title:'Previous Upscayl Session Found',
        message:'An unfinished processing session was found for this folder.',
        detail:`${session.completed} of ${session.total} images have been completed.\nWould you like to resume the previous session or start a new one?\n\n${session.source}\n${session.output}`,
        buttons:['Resume Previous Session','Start From Beginning','Cancel'],defaultId:2,cancelId:2,
      });
      if(choice.response === 0) { await batchManager().restore(session.id); return; }
      if(choice.response === 1) {
        // Create a fresh session and numbered output directory; retain prior images.
        await batchManager().restart(session.id,currentBatchEngine(),session.settings.model in MODELS ? modelsPath : savedCustomModelsPath || undefined); return;
      }
      return; // Cancel closes recovery without touching records or offering another dialog.
    }
  } catch(e) { problem(e); }
  finally {recoveryPrompt=false;}
}
export function registerJobs() {
  ipcMain.on(C.JOB_PAUSE,() => { try { batchManager().pause(); } catch(e) { problem(e); } });
  ipcMain.on(C.JOB_RESUME,() => { void batchManager().resume().catch(problem); });
  ipcMain.handle(C.JOB_GET,() => batchManager().snapshot());
  ipcMain.handle(C.JOB_DISCOVER,(_event,source) => offerRecovery(source));
  let quitting=false;
  app.on('before-quit',event => {
    if(quitting) return;
    event.preventDefault();
    void batchManager().shutdown().then(() => { quitting=true; app.quit(); }).catch(problem);
  });
  app.on('browser-window-created',(_event,window:BrowserWindow) => {
    window.on('close',event => {
      if(quitting || !batchManager().child) return;
      event.preventDefault();
      void batchManager().shutdown().then(() => { quitting=true; app.quit(); }).catch(problem);
    });
  });
}
