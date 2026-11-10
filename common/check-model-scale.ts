import { modelMetadata } from './model-metadata';
export default function getModelScale(model:string):string {
 const metadata=modelMetadata(model);if(metadata)return String(metadata.nativeScale);
 // Preserve legacy custom-model compatibility. Curated imports never rely on
 // this heuristic: they have pinned nativeScale and verified file manifests.
 const match=/(?:^|[^0-9])(?:x(16|8|4|3|2|1)(?=[^0-9]|$)|(16|8|4|3|2|1)x)/i.exec(model);
 return match?.[1]||match?.[2]||'4';
}
