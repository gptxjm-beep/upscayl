import { atom, PrimitiveAtom } from 'jotai';
export type JobState = { id:string; phase:string; failed?:number; lastError?:string; completed:number; total:number; source:string; output:string;engineStopped?:boolean;gateClosed?:boolean };
export const jobAtom = atom(null) as PrimitiveAtom<JobState | null>;
