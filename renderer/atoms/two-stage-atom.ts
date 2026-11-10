import { atom } from 'jotai';
// Deliberately opt-in on each app launch. A saved selection has no processing
// effect while the checkbox is off; legacy payloads remain byte-for-byte shaped.
export const useTwoModelsAtom=atom(false);
export const secondModelAtom=atom('');
