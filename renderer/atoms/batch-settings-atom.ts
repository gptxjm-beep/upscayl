import { atom } from 'jotai';
import * as settings from './user-settings-atom';
import type { BatchUpscaylPayload } from '@common/types/types';
export const batchSettingsAtom=atom(get=>({
 batchFolderPath:'',outputPath:get(settings.savedOutputPathAtom)||'',
 model:get(settings.selectedModelIdAtom),gpuId:get(settings.gpuIdAtom)||null,
 saveImageAs:get(settings.saveImageAsAtom),scale:get(settings.scaleAtom),
 noImageProcessing:get(settings.noImageProcessingAtom),compression:String(get(settings.compressionAtom)),
 customWidth:get(settings.customWidthAtom)>0?String(get(settings.customWidthAtom)):null,
 useCustomWidth:get(settings.useCustomWidthAtom),tileSize:get(settings.tileSizeAtom),
 ttaMode:get(settings.ttaModeAtom),copyMetadata:get(settings.copyMetadataAtom),
} as BatchUpscaylPayload));
