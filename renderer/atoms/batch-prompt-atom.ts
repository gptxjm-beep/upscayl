import { atom,PrimitiveAtom } from 'jotai';
import type { BatchPrompt } from '@common/types/batch-ui';
export const batchPromptAtom=atom(null) as PrimitiveAtom<BatchPrompt|null>;
