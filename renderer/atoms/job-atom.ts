import { atom, PrimitiveAtom } from 'jotai';
import type { BatchFailure } from '@common/types/batch-ui';
export type JobState = { report?:string; kind?:"single"|"batch"; settings?:{singleImage?:string}; id:string; phase:string; failed?:number; lastError?:string; completed:number; total:number; source:string; output:string;engineStopped?:boolean;gateClosed?:boolean;failure?:BatchFailure;logsPath?:string };
export const jobAtom = atom(null) as PrimitiveAtom<JobState | null>;
