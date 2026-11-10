import { ipcRenderer, contextBridge, webUtils } from "electron";
import {
  getAppVersion,
  getDeviceSpecs,
  getPlatform,
} from "./utils/get-device-specs";

const listeners = new Map<string, Map<Function, (...args: any[]) => void>>();

// 'ipcRenderer' will be available in index.js with the method 'window.electron'
contextBridge.exposeInMainWorld("electron", {
  send: (command: string, payload: any) => ipcRenderer.send(command, payload),
  on: (command: string, func: (...args: any[]) => any) => {
    const wrapped = (event: any, args: any) => func(event, args);
    if (!listeners.has(command)) listeners.set(command, new Map());
    const previous = listeners.get(command)!.get(func);
    if(previous) ipcRenderer.removeListener(command,previous);
    listeners.get(command)!.set(func,wrapped);
    ipcRenderer.on(command, wrapped);
  },
  off: (command: string, func?: Function) => {
    const entries = listeners.get(command);
    if(!entries) return;
    for(const [original,wrapped] of entries) {
      if(!func || original === func) { ipcRenderer.removeListener(command,wrapped); entries.delete(original); }
    }
  },
  invoke: (command: string, payload: any) =>
    ipcRenderer.invoke(command, payload),
  platform: getPlatform(),
  getSystemInfo: async () => await getDeviceSpecs(),
  getAppVersion: async () => await getAppVersion(),
  getPathForFile: (file:Parameters<typeof webUtils.getPathForFile>[0]) => {try{return webUtils.getPathForFile(file);}catch{return ''; }},
});
