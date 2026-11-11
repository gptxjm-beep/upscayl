import type { BatchUpscaylPayload } from './types';
export type BatchFailure = { image?:string; stage?:string; code?:string; reason:string; details:string };
export type RecoverySummary = { id:string; source:string; output:string; phase:string; completed:number; total:number; settings:BatchUpscaylPayload; shutdown?:'open'|'clean' };
export type RecoveryIssue = {id:string;sessionId:string;pointer:string;journal?:string;source?:string;reason:'missing'|'unreadable';details:string};
export type BatchPrompt = { token:string; kind:'startup'|'folder'|'stop'|'recovery-issue'; session?:RecoverySummary; issue?:RecoveryIssue; currentSettings?:BatchUpscaylPayload; busy:boolean; error?:string };
export type PromptChoice = 'resume'|'fresh'|'dismiss'|'stop'|'archive';
export type ActionResult = {ok:boolean;error?:string};
