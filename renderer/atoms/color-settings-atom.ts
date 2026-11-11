import {atom} from 'jotai';
import {atomWithStorage} from 'jotai/utils';
export const colorStrengthAtom=atomWithStorage<number>('jm6-color-strength',.35);
export const colorStyleAtom=atomWithStorage<'natural'|'vivid'>('jm6-color-style','natural');
// Explicit per-launch opt-in; never silently shrink an existing two-model job.
export const intermediateResizeAtom=atom(false);
