// Opt-in packaged diagnostic. No fallback, settings/journal edits or source images.
import fs from 'fs';
import path from 'path';
import os from 'os';
import {spawnSync} from 'child_process';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {PipelineRuntime,runtimeErrorCode,StageModel,StageOptions} from './onnx-worker';
import {verifiedPipelineModel} from './pipeline-model-files';
import {PIPELINE_MODELS} from '../../common/pipeline-models';
async function main(){
 const args=process.argv.slice(2),models=path.resolve(args[0]||''),cpu=args.includes('--cpu'),full=args.includes('--full'),dynamic=args.includes('--dynamic');
 if(!args[0]||(!cpu&&process.platform!=='win32'))throw Error('Provide a models folder. DirectML diagnostics require Windows x64; --cpu is an explicitly labelled functional check only.');
 if(process.arch!=='x64')throw Error('An x64 application is required.');
 const at=args.indexOf('--output'),directory=at>=0?path.resolve(args[at+1]):fs.mkdtempSync(path.join(os.tmpdir(),'jm6-fdat-diagnostic-'));fs.mkdirSync(directory,{recursive:true});
 const report:any={target:'Windows 10 x64 / RTX 3060 Ti 8GB',actualPlatform:process.platform,actualKernel:os.release(),runtime:ort.env.versions,provider:cpu?'cpu':'dml',deviceIndex:0,mode:full?'complete-images':'tensor-probes-only',shapeMode:dynamic?'dynamic':'static-spatial',gpuFixProven:false,tests:[]};
 const runtime=new PipelineRuntime(),write=()=>fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(report,null,2));
 console.log('Local diagnostic output:',directory);
 try{for(const id of ['4x-illustrationjanai-v3detail-fdat-xl','4x-illustrationjanai-v3denoise-fdat-xl']){
  const meta=PIPELINE_MODELS[id];const verified=await verifiedPipelineModel(models,id);if(!verified)throw Error('Verified corrected FDAT model missing: '+id);const m=verified.manifest;
  const model:StageModel={id,directory:models,engine:'onnx',nativeScale:m.nativeScale,inputMultiple:m.inputMultiple,minimum:meta.minimum,halo:meta.halo,version:m.modelVersion,hash:m.files.model.sha256,manifest:m};
  const shapes=full?[[256,256],[512,512],[720,804]]:[[160,160],[192,192],[112,72]];
  for(let i=0;i<shapes.length;i++){
   const [w,h]=shapes[i],entry:any={id,graphVersion:m.graphVersion,graphSha256:model.hash,input:[w,h],completeImage:full},started=Date.now();report.tests.push(entry);
   const options:StageOptions={tileSize:128,ttaMode:false,gpuId:'0',compression:'0',format:'png',provider:cpu?'cpu':'dml',fdatShapeMode:dynamic?'dynamic':'static',diagnosticDirectory:path.join(directory,id,String(i)),diagnosticContext:{diagnostic:true}};
   try{
    if(full){const input=path.join(directory,id+'-'+i+'-input.png'),out=path.join(directory,id+'-'+i+'-output.png'),rgb=Buffer.alloc(w*h*3);for(let p=0;p<rgb.length;p++)rgb[p]=(p*17+(p%w)*31)%256;await sharp(rgb,{raw:{width:w,height:h,channels:3}}).png().toFile(input);await runtime.stage(model,input,out,{...options,width:w*2,height:h*2});const decoded=await sharp(out,{failOn:'warning'}).raw().toBuffer({resolveWithObject:true});if(decoded.info.width!==w*2||decoded.info.height!==h*2)throw Error('Incorrect decoded dimensions');entry.output=[decoded.info.width,decoded.info.height];}
    else{const input=new Float32Array(3*w*h);for(let p=0;p<input.length;p++)input[p]=((p*17)%256)/255;const out=await runtime.predict(model,input,w,h,options);if(out.dims.join(',')!==[1,3,h*4,w*4].join(','))throw Error('Invalid output tensor');for(const value of out.data as Float32Array)if(!Number.isFinite(value))throw Error('Non-finite output tensor');entry.output=out.dims;}
    entry.passed=true;
   }catch(error){entry.passed=false;entry.code=runtimeErrorCode(error);entry.error=String(error);entry.diagnostic=(error as any).runtimeDiagnostic;}
   entry.durationMs=Date.now()-started;write();
   if(!entry.passed)break; // No repeated failing driver calls for this model.
  }
 }
 }finally{
  if(process.platform==='win32'){
   const script=path.join(process.resourcesPath||path.resolve(__dirname,'../../..','resources'),'diagnostics/windows-directml-info.ps1');
   if(fs.existsSync(script)){const probe=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',fs.readFileSync(script,'utf8')],{encoding:'utf8',timeout:30000,windowsHide:true,env:{...process.env,JM6_DIAGNOSTIC_PROCESS_ID:String(process.pid),JM6_DIAGNOSTIC_DLL_DIRECTORY:path.join(process.resourcesPath||'', 'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/win32/x64')}});try{report.windows=JSON.parse(probe.stdout);}catch{report.platformProbeError=String(probe.error||probe.stderr||'No JSON from read-only platform probe');}}
  }
  await runtime.release();
  report.profiles=[];
  function profiles(dir:string){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())profiles(file);else if(/\.json$/.test(entry.name)&&entry.name!=='summary.json'){try{const events=JSON.parse(fs.readFileSync(file,'utf8')),providers:Record<string,number>={},copies:any[]=[];for(const e of events){const provider=e.args?.provider;if(provider)providers[provider]=(providers[provider]||0)+1;if(/Memcpy/.test(e.name||''))copies.push({name:e.name,provider,shape:e.args?.input_type_shape});}report.profiles.push({file:path.relative(directory,file),providers,copies});}catch{}}}}
  profiles(directory);report.allPassed=report.tests.length===6&&report.tests.every((t:any)=>t.passed);write();
 }
 console.log('Summary:',path.join(directory,'summary.json'));if(!report.allPassed)process.exitCode=1;
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
