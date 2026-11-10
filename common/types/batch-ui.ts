import type { BatchUpscaylPayload } from './types';
export type BatchFailure = { image?:string; stage?:string; code?:string; reason:string; details:string };
export type RecoverySummary = { id:string; source:string; output:string; phase:string; completed:number; total:number; settings:BatchUpscaylPayload; shutdown?:'open'|'clean' };
export type BatchPrompt = { token:string; kind:'startup'|'folder'|'stop'; session?:RecoverySummary; currentSettings?:BatchUpscaylPayload; busy:boolean; error?:string };
export type PromptChoice = 'resume'|'fresh'|'dismiss'|'stop';
export type ActionResult = {ok:boolean;error?:string};
