import fs from 'fs';
import path from 'path';
import { OPTIONAL_MODELS } from '../../common/model-metadata';
import { hash } from './store';
export async function verifiedOptionalModel(directory:string,id:string):Promise<string|undefined>{
 const metadata=OPTIONAL_MODELS[id];if(!metadata)return undefined;
 const file=path.join(directory,id+'.model.json');
 if(!fs.existsSync(file))throw Error(`${metadata.name}: import and verify the original model before selecting it.`);
 const saved=JSON.parse(await fs.promises.readFile(file,'utf8'));
 if(saved.version!==1||saved.id!==id||saved.nativeScale!==metadata.nativeScale||saved.inputMultiple!==metadata.inputMultiple||metadata.prepadding!==undefined&&saved.prepadding!==metadata.prepadding||!!saved.fullPrecision!==!!metadata.fullPrecision||saved.sourceSha256!==metadata.sourceSha256||saved.license!==metadata.license||saved.licenseAccepted!==true||saved.validation?.passed!==true||saved.validation?.pipeline!=='jm5-model-api-v1')throw Error('Optional model manifest is not a verified, license-acknowledged import.');
 const param=await hash(path.join(directory,id+'.param')),bin=await hash(path.join(directory,id+'.bin'));
 if(param!==saved.files?.param||bin!==saved.files?.bin)throw Error('Optional model files changed after validation. Re-import and test them.');
 return param+':'+bin;
}
