import catalog from "./optional-models.json";
import { MODELS } from './models-list';
// Metadata is authoritative for shipped and curated optional models. Optional
// weights stay inactive until the user's import has a verified manifest.
export const OPTIONAL_MODELS: Record<string,{name:string;nativeScale:number;inputMultiple:number;prepadding?:number;fullPrecision?:boolean;source:string;license:string;sourceSha256:string}> = catalog;
export function modelMetadata(id:string):{nativeScale:number;inputMultiple:number;name:string;prepadding?:number;fullPrecision?:boolean}|undefined {
 if(id in MODELS)return {nativeScale:MODELS[id].nativeScale,inputMultiple:1,name:id};
 return OPTIONAL_MODELS[id];
}
export function modelDisplayName(id:string){const m=OPTIONAL_MODELS[id];return m?`${m.name} — ${m.nativeScale}X`:id;}
