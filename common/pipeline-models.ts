// Curated identities are separate from file names and UI translations. A listed
// identity is never selectable without a verified import in the selected folder.
export type PipelineModelInfo={name:string;fullName:string;version:string;engine:'onnx';task:'upscale'|'color-lut'|'color-recipe';nativeScale:number;inputMultiple:number;minimum:number;halo:number;source:string;sourceSha256:string;license:string;author:string;graphVersion?:string;opset?:number};
import catalog from './pipeline-models.json';
export const PIPELINE_MODELS=catalog as Record<string,PipelineModelInfo>;

export function isPipelineModel(id:string){return Object.prototype.hasOwnProperty.call(PIPELINE_MODELS,id);}
export function isColorModel(id:string){return isPipelineModel(id)&&PIPELINE_MODELS[id].task.startsWith('color-');}
export function needsPipeline(settings:{model:string;useTwoModels?:boolean;secondModel?:string;intermediateResize?:boolean}){return isPipelineModel(settings.model)||!!settings.useTwoModels&&isPipelineModel(settings.secondModel||'')||!!settings.intermediateResize;}
export type PipelineManifest={version:2;id:string;modelVersion:string;engine:'onnx';task:PipelineModelInfo['task'];nativeScale:number;inputMultiple:number;sourceSha256:string;license:string;licenseAccepted:boolean;files:Record<string,{name:string;sha256:string}>;validation:{pipeline:'jm6-onnx-v1';passed:boolean;images:number;provider:string;cases:unknown[]};input:string;output:string;lutSize?:number;transformation?:string;graphVersion?:string;opset?:number;spatialSymbols?:[string,string]};
