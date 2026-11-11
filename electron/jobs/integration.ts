import { app, ipcMain, BrowserWindow, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import isDev from 'electron-is-dev';
import { BatchManager } from './manager';
import { BatchPrompts,startupRecoverable } from './prompts';
import { writeBatchEvent, pruneBatchLogs } from './log';
import { modelsPath } from '../utils/get-resource-paths';
import { savedCustomModelsPath } from '../utils/config-variables';
import { MODELS } from '../../common/models-list';
import { copyMetadata } from '../utils/copy-metadata';
import { getMainWindow } from '../main-window';
import { ELECTRON_COMMANDS as C } from '../../common/electron-commands';
import type { BatchUpscaylPayload } from '../../common/types/types';
import type { PromptChoice } from '../../common/types/batch-ui';

let manager:BatchManager;
let startupChecked=false;
export const batchPrompts=new BatchPrompts();
const send=(command:string,data:any)=>{const w=getMainWindow();if(w&&!w.isDestroyed())w.webContents.send(command,data);};
const logsPath=()=>path.join(app.getPath('userData'),'logs');
const problem=(e:any)=>{lifecycle('warning',{error:String(e)});send(C.UPSCAYL_WARNING,String(e));};
const lifecycle=(kind:string,data:unknown)=>{try{writeBatchEvent(logsPath(),undefined,kind,data);}catch{}};
batchPrompts.on('change',prompt=>send(C.JOB_PROMPT,prompt));
export function batchManager(){
 if(!manager){
  manager=new BatchManager(path.join(app.getPath('userData'),'enhanced-sessions'),copyMetadata);
  manager.on('state',state=>{send(C.JOB_STATE,state?{...state,logsPath:logsPath()}:state);if(state?.phase==='completed'){if(state.kind==='single')send(C.UPSCAYL_DONE,path.join(state.output,manager.session!.items[0].name));else send(C.FOLDER_UPSCAYL_DONE,state.output);}});
  manager.on('problem',problem);manager.on('log',data=>send(C.LOG,data));
 }
 return manager;
}
function currentBatchEngine(){
 return isDev?path.join(app.getAppPath(),'resources',process.platform==='win32'?'win':process.platform==='darwin'?'mac':'linux','bin',process.platform==='win32'?'upscayl-jm.exe':'upscayl-jm')
 :path.join(path.dirname(app.getAppPath()),'bin',process.platform==='win32'?'upscayl-jm.exe':'upscayl-jm');
}
const secondDirectory=(settings:BatchUpscaylPayload)=>settings.secondModel?modelDirectory({...settings,model:settings.secondModel}):undefined;
const modelDirectory=(settings:BatchUpscaylPayload)=>settings.model in MODELS?modelsPath:savedCustomModelsPath||modelsPath;
export function offerRecovery(source?:string,currentSettings?:BatchUpscaylPayload){
 if(batchPrompts.current)return;
 const active=batchManager().session;
 if(active&&['preparing','resuming','recovering','running','pausing','paused'].includes(active.phase))return;
 const kind=source?'folder':'startup';
 const sessions=batchManager().discover(source,currentSettings?.singleImage).filter(s=>kind==='folder'||startupRecoverable(s));
 const session=sessions[0];if(!session)return;
 lifecycle('recovery-detected',{kind,id:session.id,completed:session.completed,total:session.total});
 void batchPrompts.open({kind,session,currentSettings},async choice=>{
  lifecycle('recovery-action',{kind,id:session.id,choice});
  if(choice==='dismiss'){send(C.JOB_STATE,batchManager().snapshot());return;}
  try{
   if(choice==='resume')await batchManager().restore(session.id,currentBatchEngine(),modelDirectory(session.settings),secondDirectory(session.settings));
   else if(choice==='fresh'){
    if(!currentSettings)throw new Error('Select your current batch settings before starting fresh.');
    await batchManager().restart(session.id,currentBatchEngine(),modelDirectory(currentSettings),currentSettings,secondDirectory(currentSettings));
   }
   await batchManager().whenStarted();
   lifecycle('recovery-started',{kind,id:session.id,choice});
  }catch(error){lifecycle('recovery-error',{kind,id:session.id,error:String(error)});throw error;}
 });
}
export async function startBatch(_event:any,payload:BatchUpscaylPayload){
 try{
  if(batchPrompts.current)return;
  if(payload.singleImage)payload={...payload,batchFolderPath:path.dirname(path.resolve(payload.singleImage))};
  if(batchManager().discover(payload.batchFolderPath,payload.singleImage).length){offerRecovery(payload.batchFolderPath,payload);if(batchPrompts.current)return;}
  const engine=currentBatchEngine();if(!fs.existsSync(engine))throw new Error('Enhanced batch engine is missing.');
  await batchManager().create(payload,modelDirectory(payload),engine,secondDirectory(payload));
 }catch(error){problem(error);send(C.JOB_STATE,batchManager().snapshot());}
}
export async function requestBatchStop():Promise<boolean>{
 const session=batchManager().snapshot();
 const summary=session?{...session}:undefined;
 const choice=await batchPrompts.open({kind:'stop',session:summary},async action=>{
  if(action==='dismiss'){lifecycle('stop-dismissed',{id:session?.id});return;}
  if(session?.id&&batchManager().snapshot()?.id!==session.id)throw new Error('The original task has changed. Close this dialog and try again.');
  lifecycle('stop-confirmed',{id:session?.id});await batchManager().cancel();lifecycle('stop-completed',{id:session?.id});
 });
 return choice==='stop';
}
export function registerJobs(){
 try{pruneBatchLogs(logsPath());}catch{}
 ipcMain.on(C.JOB_PAUSE,()=>{try{batchManager().pause();}catch(error){problem(error);}});
 ipcMain.handle(C.JOB_PAUSE,async()=>{try{batchManager().pause();return {ok:true};}catch(error){return {ok:false,error:String(error)};}});
 ipcMain.on(C.JOB_RESUME,()=>{void batchManager().resume().catch(problem);});
 ipcMain.handle(C.JOB_RESUME,async()=>{try{await batchManager().resume();await batchManager().whenStarted();return {ok:true};}catch(error){return {ok:false,error:String(error)};}});
 ipcMain.handle(C.JOB_GET,()=>{const state=batchManager().snapshot();return state?{...state,logsPath:logsPath()}:null;});
 ipcMain.handle(C.JOB_DISCOVER,(_event,payload)=>offerRecovery(typeof payload==='string'?payload:payload?.source,payload?.settings));
 ipcMain.handle(C.JOB_PROMPT_GET,()=>{if(!startupChecked){startupChecked=true;offerRecovery();}return batchPrompts.current;});
 ipcMain.handle(C.JOB_PROMPT_ACTION,(_event,payload:{token:string;choice:PromptChoice})=>batchPrompts.act(payload?.token,payload?.choice));
 const openJobPath=async(kind:'report'|'output',id:string)=>{
  try{const session=batchManager().session;if(!session||session.id!==id)throw Error('This job is no longer selected.');
   const file=kind==='report'?session.report:session.output;if(!file)throw Error('The report is not available.');
   if(kind==='report'&&(path.dirname(file)!==session.output||!/^upscayl_batch_report(?:_\d+)?\.txt$/.test(path.basename(file))||!fs.lstatSync(file).isFile()))throw Error('Invalid report path.');
   const error=await shell.openPath(file);return {ok:!error,error};
  }catch(error){return {ok:false,error:String(error)};}
 };
 ipcMain.handle(C.JOB_OPEN_REPORT,(_event,payload)=>openJobPath('report',payload?.id));
 ipcMain.handle(C.JOB_OPEN_OUTPUT,(_event,payload)=>openJobPath('output',payload?.id));
 ipcMain.handle(C.JOB_OPEN_LOGS,async()=>{fs.mkdirSync(logsPath(),{recursive:true});const error=await shell.openPath(logsPath());return {ok:!error,error,path:logsPath()};});
 let quitting=false;
 const closeSafely=()=>{void batchManager().shutdown().then(()=>{quitting=true;app.quit();}).catch(problem);};
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();closeSafely();});
 app.on('browser-window-created',(_event,window:BrowserWindow)=>{window.on('close',event=>{if(quitting||!batchManager().child)return;event.preventDefault();closeSafely();});});
}
