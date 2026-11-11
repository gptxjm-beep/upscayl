import {isColorModel,PIPELINE_MODELS} from '../../common/pipeline-models';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import getModelScale from '../../common/check-model-scale';
import type { BatchUpscaylPayload } from '../../common/types/types';
import { hash } from './store';

export type ImageStage='stage1-pending'|'stage1-processing'|'stage1-complete'|'stage2-processing'|'final-verification'|'completed'|'failed';
export type Checkpoint={file:string;hash:string;owner:string;sourceHash:string;settingsHash:string;modelsHash:string;size:[number,number]};
export function twoStageDimensions(size:[number,number],settings:BatchUpscaylPayload){
 const first=Number(getModelScale(settings.model)),second=Number(getModelScale(settings.secondModel||''));
 const firstNative:[number,number]=[size[0]*first,size[1]*first];
 const final:[number,number]=settings.useCustomWidth?[Number(settings.customWidth),Math.floor(size[1]*Number(settings.customWidth)/size[0])]:[size[0]*Number(settings.scale),size[1]*Number(settings.scale)];
 let middle:[number,number]=firstNative;
 if(isColorModel(settings.secondModel||''))middle=final;
 else if(settings.intermediateResize){const width=Math.max(1,Math.ceil(final[0]/second));middle=[width,Math.max(1,Math.floor(size[1]*width/size[0]))];}
 const native:[number,number]=[middle[0]*second,middle[1]*second];
 if(!settings.secondModel||[...size,...firstNative,...middle,...native,...final].some(v=>!Number.isSafeInteger(v)||v<=0))throw Error('Two-stage processing requires two valid models and positive dimensions.');
 const bytes=([w,h]:[number,number])=>w*h*4;
 if([size,firstNative,middle,native,final].some(dim=>bytes(dim)>0x7fffffff))throw Error(`Unsafe two-stage dimensions: ${native.join(' × ')} internally. Reduce model scales; stages are never silently resized.`);
 // Capacity one still needs source, intermediate, inference output and resize
 // buffers. This admission estimate leaves half of currently free host RAM.
 const estimate=2*(bytes(size)+bytes(middle)+bytes(native)+bytes(final)+((middle[0]!==firstNative[0]||middle[1]!==firstNative[1])&&PIPELINE_MODELS[settings.model]?.task!=='upscale'?bytes(firstNative):0));
 if(estimate>os.freemem()/2)throw Error('Insufficient available RAM for this two-stage image. No inference was started.');
 return {middle,native,final,estimate,first,second};
}
export function checkpointFile(stateFile:string,index:number){return path.join(path.dirname(stateFile),'intermediates',String(index)+'.png');}
export async function validateCheckpointImage(file:string,expected:[number,number]){
 const stat=await fs.promises.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Checkpoint is not a regular owned file.');
 const image=sharp(await fs.promises.readFile(file),{failOn:'warning',limitInputPixels:false});const info=await image.metadata();
 if(info.format!=='png'||info.width!==expected[0]||info.height!==expected[1])throw Error('Invalid checkpoint dimensions/format.');
 await image.stats();return hash(file);
}
export function syncFile(file:string){const fd=fs.openSync(file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
