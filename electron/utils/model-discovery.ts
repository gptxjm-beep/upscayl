import fs from 'fs';
import path from 'path';
import {verifiedOptionalModel} from '../jobs/model-files';
import {verifiedPipelineModel} from '../jobs/pipeline-model-files';
import {isPipelineModel} from '../../common/pipeline-models';
export async function discoverModels(folder:string){
 const models:string[]=[],issues:{file:string;reason:string}[]=[];
 const entries=await fs.promises.readdir(folder,{withFileTypes:true});
 const ids=new Set(entries.filter(e=>e.isFile()&&/\.(param|bin|model\.json)$/i.test(e.name)).map(e=>e.name.replace(/\.(param|bin|model\.json)$/i,'')));
 const seen=new Set<string>();
 for(const id of [...ids].sort()){
  if(!id||path.basename(id)!==id||seen.has(id.toLowerCase()))continue;
  try{
   if(isPipelineModel(id)){await verifiedPipelineModel(folder,id);}
   else{
    const param=path.join(folder,id+'.param'),bin=path.join(folder,id+'.bin');
    for(const file of [param,bin]){const s=await fs.promises.lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Incomplete or unsafe NCNN model pair.');}
    const fd=await fs.promises.open(param,'r');let header:Buffer;
    try{header=Buffer.alloc(1024);const r=await fd.read(header,0,header.length,0);header=header.subarray(0,r.bytesRead);}finally{await fd.close();}
    if(!/^\s*7767517\s+[1-9]\d*\s+[1-9]\d*\s/.test(header.toString('utf8')))throw Error('Invalid NCNN parameter header.');
    await verifiedOptionalModel(folder,id);
   }
   seen.add(id.toLowerCase());models.push(id);
  }catch(error){issues.push({file:id,reason:String(error)});}
 }
 return {models,issues};
}
