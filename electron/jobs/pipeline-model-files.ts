import fs from 'fs';
import path from 'path';
import {PIPELINE_MODELS,PipelineManifest} from '../../common/pipeline-models';
import {hash} from './store';
export async function verifiedPipelineModel(directory:string,id:string):Promise<{manifest:PipelineManifest;hash:string}|undefined>{
 const expected=PIPELINE_MODELS[id];if(!expected)return undefined;
 if(!expected.sourceSha256||expected.license==='unverified')throw Error(`${expected.name}: the official source and license have not yet been verified. This model is unavailable.`);
 const file=path.join(directory,id+'.model.json'),stat=await fs.promises.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)throw Error('Invalid model manifest file.');
 const m:PipelineManifest=JSON.parse(await fs.promises.readFile(file,'utf8'));
 if(m.version!==2||m.id!==id||m.modelVersion!==expected.version||m.engine!=='onnx'||m.task!==expected.task||m.nativeScale!==expected.nativeScale||m.inputMultiple!==expected.inputMultiple||m.sourceSha256!==expected.sourceSha256||m.license!==expected.license||!m.licenseAccepted||m.validation?.pipeline!=='jm6-onnx-v1'||m.validation.passed!==true||!Number.isInteger(m.validation.images)||m.validation.images<3||m.validation.images>5||!Array.isArray(m.validation.cases)||m.validation.cases.length<m.validation.images||!m.validation.cases.every((c:any)=>c?.passed===true&&Number.isFinite(c.maxAbs)&&c.maxAbs<=24&&Number.isFinite(c.mae)&&c.mae<=2&&Number.isFinite(c.psnrDb)&&c.psnrDb>=40)||!m.input||!m.output)throw Error('Model import has no matching source, license and completed inference validation.');
 if(!m.files?.model||!m.files.license||!m.files.attribution||expected.task==='color-lut'&&(!m.files.luts||m.lutSize!==33))throw Error('Missing model inference files.');
 const identities:string[]=[];
 for(const [role,f]of Object.entries(m.files)){
  if(!f||path.basename(f.name)!==f.name||!f.name.startsWith(id+'.')||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Unsafe model file reference.');
  const p=path.join(directory,f.name),s=await fs.promises.lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('Model files must be regular files.');
  const digest=await hash(p);if(digest!==f.sha256)throw Error(`${expected.name}: model files changed after validation.`);identities.push(role+':'+digest);
 }
 return {manifest:m,hash:identities.sort().join('|')};
}
