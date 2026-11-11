// Isolated ONNX/DirectML worker. Keep this module self-contained so the session
// pins its complete application logic by hashing this compiled file.
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {spawn} from 'child_process';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import type {PipelineManifest} from '../../common/pipeline-models';
export type StageModel={id:string;directory:string;engine:'onnx'|'ncnn';nativeScale:number;inputMultiple:number;minimum:number;halo:number;version:string;hash:string;manifest?:PipelineManifest;nativeEngine?:string;nativeHash?:string;fullPrecision?:boolean};
export type StageOptions={tileSize:number;ttaMode:boolean;gpuId:string;compression:string;format:'png'|'jpg'|'webp';width?:number;height?:number;colorStrength?:number;colorStyle?:'natural'|'vivid';provider?:'cpu'|'dml';control?:string};
const ORT_VERSION='1.31.1',MAX_FRAME=0x7fffffff;
sharp.cache({files:0});sharp.concurrency(2);
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const log=(value:unknown)=>process.stderr.write('[JM6] '+JSON.stringify(value)+'\n');
const digest=async(file:string)=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
function dimensions(w:number,h:number){if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<=0||h<=0||w*h*4>MAX_FRAME)throw Object.assign(Error('Unsafe image dimensions; no buffer was allocated.'),{stage:'dimensions'});}
const image=(file:string|Buffer)=>sharp(file,{failOn:'warning',limitInputPixels:false});
async function encode(source:sharp.Sharp,file:string,options:StageOptions){
 if(options.format==='png')source=source.png({compressionLevel:Math.round(clamp(Number(options.compression)||0,0,100)*.09)});
 else if(options.format==='jpg')source=source.jpeg({quality:clamp(100-Number(options.compression),1,100),chromaSubsampling:'4:4:4'});
 else source=source.webp({quality:clamp(100-Number(options.compression),1,100)});
 try{await source.toFile(file);}catch(error){throw Object.assign(error as Error,{stage:'encode'});}
}
function chw(rgb:Buffer,width:number,height:number){const area=width*height,data=new Float32Array(3*area);for(let i=0;i<area;i++)for(let c=0;c<3;c++)data[c*area+i]=rgb[3*i+c]/255;return data;}
function orient(data:Float32Array,w:number,h:number,swap:boolean,fx:boolean,fy:boolean){const out=new Float32Array(data.length),vw=swap?h:w,vh=swap?w:h;for(let c=0;c<3;c++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=fx?w-1-x:x,b=fy?h-1-y:y,tx=swap?b:a,ty=swap?a:b;out[c*vw*vh+ty*vw+tx]=data[c*w*h+y*w+x];}return {data:out,width:vw,height:vh};}
// Match PyTorch interpolate(..., align_corners=False): one global thumbnail,
// never separate content-dependent LUTs per tile/stripe of a long page.
function thumbnail(rgb:Buffer,w:number,h:number){const n=256,out=new Float32Array(3*n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const sx=Math.max(0,(x+.5)*w/n-.5),sy=Math.max(0,(y+.5)*h/n-.5),x0=Math.min(w-1,Math.floor(sx)),y0=Math.min(h-1,Math.floor(sy)),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),dx=sx-x0,dy=sy-y0;for(let c=0;c<3;c++)out[c*n*n+y*n+x]=((1-dy)*((1-dx)*rgb[(y0*w+x0)*3+c]+dx*rgb[(y0*w+x1)*3+c])+dy*((1-dx)*rgb[(y1*w+x0)*3+c]+dx*rgb[(y1*w+x1)*3+c]))/255;}return out;}
export async function applyLut(rgb:Buffer,basis:Float32Array,weights:Float32Array,dim:number,strength:number,style:'natural'|'vivid',yieldControl=true){
 if(dim!==33||weights.length!==3||basis.length!==3*3*dim**3||[...weights].some(v=>!Number.isFinite(v)))throw Error('Invalid adaptive LUT output.');
 const count=dim**3,lut=new Float32Array(3*count),out=Buffer.allocUnsafe(rgb.length),binsize=1.000001/(dim-1);
 for(let i=0;i<lut.length;i++)lut[i]=weights[0]*basis[i]+weights[1]*basis[lut.length+i]+weights[2]*basis[2*lut.length+i];
 const power=clamp(strength,0,1)*(style==='natural'?.75:1);
 for(let i=0;i<rgb.length;i+=3){
  const r=rgb[i],g=rgb[i+1],b=rgb[i+2],p=[r,g,b].map(v=>v/255/binsize),ix=p.map(Math.floor),f=p.map((v,c)=>v-ix[c]);
  // Natural and Vivid both preserve neutral text/white; Natural blends gently.
  const chroma=Math.max(r,g,b)-Math.min(r,g,b),neutral=chroma/(chroma+8),white=clamp((255-Math.min(r,g,b))/24,0,1),alpha=power*neutral*white;
  for(let c=0;c<3;c++){let value=0;for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){const index=ix[0]+x+(ix[1]+y)*dim+(ix[2]+z)*dim*dim;value+=lut[c*count+index]*(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);}if(!Number.isFinite(value))throw Error('Non-finite color output.');out[i+c]=Math.round(clamp(rgb[i+c]*(1-alpha)+clamp(value*255,0,255)*alpha,0,255));}
  if(yieldControl&&i>0&&i%(3*262144)===0)await new Promise<void>(resolve=>setImmediate(resolve));
 }
 return out;
}
export class PipelineRuntime{
 private resident?:{id:string;session:ort.InferenceSession};
 async release(){if(this.resident){const current=this.resident;this.resident=undefined;await current.session.release();}}
 private async load(model:StageModel,options:StageOptions){
  if(this.resident?.id===model.id)return this.resident.session;
  await this.release();const m=model.manifest;if(!m)throw Error('Verified model manifest is missing.');
  for(const f of Object.values(m.files))if(await digest(path.join(model.directory,f.name))!==f.sha256)throw Error('Model files changed before loading.');
  if(ort.env.versions.node!==ORT_VERSION)throw Error('ONNX Runtime version changed.');
  const provider=options.provider||(process.platform==='win32'?'dml':'cpu');
  if(!ort.listSupportedBackends().some(b=>b.name===provider&&b.bundled))throw Error(`Required ONNX execution provider ${provider} is not available.`);
  const session=await ort.InferenceSession.create(path.join(model.directory,m.files.model.name),{executionProviders:provider==='dml'?[{name:'dml',deviceId:Number(options.gpuId)||0}]:['cpu'],executionMode:'sequential',enableMemPattern:false,intraOpNumThreads:2,interOpNumThreads:1});
  this.resident={id:model.id,session};log({event:'model-loaded',id:model.id,version:model.version,hash:model.hash,graphSha256:m.files.model.sha256,sourceSha256:m.sourceSha256,provider,device:options.gpuId,residency:'one-onnx-session',runtime:ORT_VERSION});return session;
 }
 async predict(model:StageModel,input:Float32Array,width:number,height:number,options:StageOptions){
  const session=await this.load(model,options),m=model.manifest!,out=await session.run({[m.input]:new ort.Tensor('float32',input,[1,3,height,width])});
  const tensor=out[m.output];if(!tensor||tensor.type!=='float32')throw Error('Unexpected ONNX output tensor type.');return tensor;
 }
 private async infer(model:StageModel,rgb:Buffer,w:number,h:number,options:StageOptions){
  const source=chw(rgb,w,h),ow=w*model.nativeScale,oh=h*model.nativeScale,result=new Float32Array(3*ow*oh),passes=options.ttaMode?8:1;
  for(let pass=0;pass<passes;pass++){
   const swap=!!(pass&4),fx=!!(pass&1),fy=!!(pass&2),input=pass?orient(source,w,h,swap,fx,fy):{data:source,width:w,height:h};
   const output=await this.predict(model,input.data,input.width,input.height,options),vw=input.width*model.nativeScale,vh=input.height*model.nativeScale;
   if(output.dims.join(',')!==[1,3,vh,vw].join(','))throw Error('Model output dimensions do not match the declared native scale.');
   const values=output.data as Float32Array;
   for(let c=0;c<3;c++)for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){const a=fx?ow-1-x:x,b=fy?oh-1-y:y,tx=swap?b:a,ty=swap?a:b;result[c*ow*oh+y*ow+x]+=values[c*vw*vh+ty*vw+tx]/passes;}
  }
  const data=Buffer.allocUnsafe(3*ow*oh);for(let i=0;i<ow*oh;i++)for(let c=0;c<3;c++){const v=result[c*ow*oh+i];if(!Number.isFinite(v))throw Error('Non-finite model pixels.');data[3*i+c]=Math.round(clamp(v*255,0,255));}return {data,width:ow,height:oh};
 }
 async stage(model:StageModel,input:string,output:string,options:StageOptions){
  const meta=await image(input).metadata().catch(error=>{throw Object.assign(error,{stage:'decode'});});if(!meta.width||!meta.height||!['png','jpeg','webp'].includes(meta.format||''))throw Object.assign(Error('Source cannot be decoded.'),{stage:'decode'});
  const w=meta.width,h=meta.height;dimensions(w,h);dimensions(w*model.nativeScale,h*model.nativeScale);
  if(model.engine==='ncnn'){await this.native(model,input,output,options);return;}
  if(model.manifest?.task==='color-lut'){
   if(w*h*6>Math.min(1024**3,os.freemem()/2))throw Error('Insufficient RAM for the dimension-preserving color stage.');
   const rgb=await image(input).removeAlpha().toColourspace('srgb').raw().toBuffer(),prediction=await this.predict(model,thumbnail(rgb,w,h),256,256,options);
   const file=fs.readFileSync(path.join(model.directory,model.manifest.files.luts.name));if(file.length%4)throw Error('Invalid LUT file size.');
   const basis=new Float32Array(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength)),pixels=await applyLut(rgb,basis,prediction.data as Float32Array,model.manifest.lutSize!,options.colorStrength??.35,options.colorStyle||'natural');
   let result=sharp(pixels,{raw:{width:w,height:h,channels:3},limitInputPixels:false});
   if(meta.hasAlpha)result=result.joinChannel(await image(input).ensureAlpha().extractChannel(3).png().toBuffer());
   if(options.width&&options.width!==w)result=result.resize(options.width,options.height,{fit:'fill',kernel:'lanczos3'});
   await encode(result,output,options);log({event:'color-applied',id:model.id,dimensions:[w,h],weights:Array.from(prediction.data as Float32Array),strength:options.colorStrength??.35,style:options.colorStyle||'natural',globalLut:true});return;
  }
  if(model.manifest?.task!=='upscale')throw Error('This color recipe has not been implemented or verified.');
  const multiple=model.inputMultiple,tile=Math.max(multiple,Math.floor(clamp(options.tileSize||128,32,512)/multiple)*multiple),halo=model.halo,scale=model.nativeScale;
  log({event:'tiling',id:model.id,requested:options.tileSize,effective:tile,halo,tta:options.ttaMode});
  const work=output+'.tiles';fs.mkdirSync(work,{recursive:false});let native=output+'.native.png';
  try{
   let stripes:{input:string;left:number;top:number;width:number;height:number}[]=[];let index=0;
   for(let y=0;y<h;y+=tile){
    const ch=Math.min(tile,h-y),row:{input:string;left:number;top:number}[]=[];
    for(let x=0;x<w;x+=tile){
     const cw=Math.min(tile,w-x),left=Math.max(0,x-halo),top=Math.max(0,y-halo),width=Math.min(w,x+cw+halo)-left,height=Math.min(h,y+ch+halo)-top,pw=Math.max(model.minimum,Math.ceil(width/multiple)*multiple),ph=Math.max(model.minimum,Math.ceil(height/multiple)*multiple);
     const rgb=await image(input).extract({left,top,width,height}).extend({right:pw-width,bottom:ph-height,left:0,top:0,extendWith:'mirror'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
     const out=await this.infer(model,rgb,pw,ph,options),file=path.join(work,String(index++)+'.png');
     await sharp(out.data,{raw:{width:out.width,height:out.height,channels:3},limitInputPixels:false}).extract({left:(x-left)*scale,top:(y-top)*scale,width:cw*scale,height:ch*scale}).png({compressionLevel:0}).toFile(file);row.push({input:file,left:x*scale,top:0});
    }
    const file=path.join(work,'stripe-'+y+'.png');await sharp({create:{width:w*scale,height:ch*scale,channels:3,background:'black'},limitInputPixels:false}).composite(row).png({compressionLevel:0}).toFile(file);for(const f of row)fs.rmSync(f.input);stripes.push({input:file,left:0,top:y*scale,width:w*scale,height:ch*scale});
   }
   // Group strips before final assembly, bounding open codecs for long pages.
   let level=0;while(stripes.length>32){const grouped:typeof stripes=[];for(let start=0;start<stripes.length;start+=32){const group=stripes.slice(start,start+32),height=group.reduce((n,s)=>n+s.height,0),file=path.join(work,`level-${level}-${start}.png`),top=group[0].top;await sharp({create:{width:w*scale,height,channels:3,background:'black'},limitInputPixels:false}).composite(group.map(f=>({input:f.input,left:0,top:f.top-top}))).png({compressionLevel:0}).toFile(file);for(const f of group)fs.rmSync(f.input);grouped.push({input:file,left:0,top,width:w*scale,height});}stripes=grouped;level++;}
   await sharp({create:{width:w*scale,height:h*scale,channels:3,background:'black'},limitInputPixels:false}).composite(stripes.map(f=>({input:f.input,left:0,top:f.top}))).png({compressionLevel:0}).toFile(native);
   // Sharp joins channels before removeAlpha, regardless of JS call order.
   // Materialize RGB separately before attaching the original resized alpha.
   let result:sharp.Sharp;
   if(meta.hasAlpha){const rgbFile=path.join(work,'rgb-native.png');await image(native).removeAlpha().png({compressionLevel:0}).toFile(rgbFile);result=image(rgbFile);}else result=image(native).removeAlpha();
   if(options.width&&(options.width!==w*scale||options.height!==h*scale))result=result.resize(options.width,options.height,{fit:'fill',kernel:'lanczos3'});
   if(meta.hasAlpha){const alphaFile=path.join(work,'original-alpha.png');await image(input).ensureAlpha().extractChannel(3).resize(options.width||w*scale,options.height||h*scale,{fit:'fill',kernel:'lanczos3'}).png().toFile(alphaFile);result=result.joinChannel(alphaFile);}
   await encode(result,output,options);
  }finally{fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:100});fs.rmSync(native,{force:true});}
 }
 private async native(model:StageModel,input:string,output:string,options:StageOptions){
  await this.release();if(!model.nativeEngine||await digest(model.nativeEngine)!==model.nativeHash)throw Error('The NCNN bridge engine changed.');
  for(const ext of ['param','bin']){const expected=model.hash.split(':')[ext==='param'?0:1];if(await digest(path.join(model.directory,model.id+'.'+ext))!==expected)throw Error('NCNN model changed before inference.');}
  const args=['-i',input,'-o',output,'-m',model.directory,'-n',model.id,'-z',String(model.nativeScale),'-g',options.gpuId||'0','-t',String(options.tileSize||0),'-f',options.format,'-c',options.compression];
  if(options.width&&options.height)args.push('-r',options.width+'x'+options.height);else if(options.width)args.push('-w',String(options.width));else args.push('-s',String(model.nativeScale));if(model.inputMultiple>1)args.push('-a',String(model.inputMultiple));if(model.fullPrecision)args.push('-F','1');if(options.ttaMode)args.push('-x');
  log({event:'ncnn-bridge',id:model.id,version:model.version,hash:model.hash,processPerStage:true});
  const control=fs.mkdtempSync(path.join(options.control||path.dirname(output),'.bridge-')),owner=options.control?path.join(options.control,'bridge-owner.json'):undefined;
  fs.writeFileSync(path.join(control,'lease'),'1');fs.writeFileSync(path.join(control,'manifest'),Buffer.from(input).toString('hex')+'\t'+Buffer.from(output).toString('hex')+'\n');args.push('-Q',control,'-L',path.join(control,'manifest'));
  try{await new Promise<void>((resolve,reject)=>{let tail='';const child=spawn(model.nativeEngine!,args,{windowsHide:true,env:process.env});
   if(owner&&child.pid){const fd=fs.openSync(owner,'w');try{fs.writeFileSync(fd,JSON.stringify({pid:child.pid,control}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
   const lease=setInterval(()=>{try{fs.utimesSync(path.join(control,'lease'),new Date(),new Date());}catch{}},2000);
   child.stdout.on('data',()=>{});child.stderr.on('data',data=>{tail=(tail+data.toString()).slice(-4000);});child.on('error',reject);child.on('close',(code,signal)=>{clearInterval(lease);if(owner)fs.rmSync(owner,{force:true});code===0&&!signal?resolve():reject(Error('NCNN stage failed: '+code+' '+tail));});
  });}finally{fs.rmSync(control,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 }
}

// Wire-compatible host journal/ACK protocol. The JS worker admits one complete
// image; NCNN-only jobs continue using the existing native worker unchanged.
// Capability signatures: @JM3 GATE, @JM5
async function main(){
 const args=process.argv.slice(2),at=args.indexOf('-Q'),control=at>=0?args[at+1]:'';
 if(!control||!path.isAbsolute(control))throw Error('A host-owned control directory is required.');
 const request=JSON.parse(fs.readFileSync(path.join(control,'pipeline.json'),'utf8')) as {models:StageModel[];options:StageOptions;twoStage:boolean;items:{source:string;output:string;checkpoint?:string;middle?:[number,number];final:[number,number];resume:number}[]};
 const runtime=new PipelineRuntime();let halted=false,failed=false,jobFailed=false,active:number|undefined;const failures=[0,0];
 const tick=()=>process.hrtime.bigint().toString(),emit=(line:string)=>process.stdout.write(line+'\n'),trace=(kind:string,id:number)=>emit(`@JM3 ${kind} ${id} ${tick()}`),stage=(kind:string,id:number)=>{if(request.twoStage)emit(`@JM5 ${kind} ${id}`);};
 const gate=()=>{if(halted)return true;let expired=false;try{expired=Date.now()-fs.statSync(path.join(control,'lease')).mtimeMs>15000;}catch{expired=true;}if(expired||fs.existsSync(path.join(control,'pause'))){halted=true;emit(`@JM3 GATE ${tick()}${active===undefined?'':' '+active}`);if(expired){log({event:'controller-lease-expired'});process.exit(2);}}return halted;};
 const monitor=setInterval(gate,20);
 const fatal=(kind:string,code:number,error:unknown)=>{failed=true;jobFailed=true;halted=true;log({event:'job-failure',stage:kind,code,error:String(error)});emit(`@JM5 FATAL ${kind} ${code}`);};
 const wait=async(file:string,reject?:string)=>{const deadline=Date.now()+180000;while(!fs.existsSync(file)){if(reject&&fs.existsSync(reject))return false;gate();if(jobFailed)throw Error('Job stopped before durable ACK');if(Date.now()>deadline)throw Error('Host ACK timed out');await new Promise(resolve=>setTimeout(resolve,20));}return true;};
 const event=(id:number,ok:boolean,kind:string,code:number)=>emit(`@JM2 ${id} ${ok?1:0} ${kind} ${code}`);
 try{
  if(request.models.length!==(request.twoStage?2:1)||request.items.length<1)throw Error('Invalid pipeline request');
  for(let id=0;id<request.items.length;id++){
   if(gate())break;const item=request.items[id];active=id;stage('ADMIT',id);trace('LOAD',id);let current=item.source,part=0;
   try{
    for(part=0;part<request.models.length;part++){
     if(part===0&&item.resume===2){current=item.checkpoint!;continue;}
     if(gate())break;
     const model=request.models[part],last=part===request.models.length-1,target=last?item.output:item.checkpoint!+'.pending.png',size=last?item.final:item.middle!;
     stage(part===0?'STAGE1':'STAGE2',id);trace('START',id);
     await runtime.stage(model,current,target,{...request.options,control,format:last?request.options.format:'png',compression:last?request.options.compression:'0',width:size[0],height:size[1]});
     trace('END',id);failures[part]=0;
     if(!last){stage('CHECKPOINT',id);const accepted=await wait(path.join(control,id+'.stage1.ack'),path.join(control,id+'.reject'));if(!accepted){failed=true;active=undefined;stage('RELEASE',id);break;}current=item.checkpoint!;}
    }
    if(part===request.models.length){stage('VERIFY',id);event(id,true,'encode',0);await wait(path.join(control,id+'.final.ack'));active=undefined;stage('RELEASE',id);}
   }catch(error){
    failed=true;const code=(error as NodeJS.ErrnoException).code,description=String(error),kind=(error as any).stage||(/decode|pngload|jpegload|unsupported image/i.test(description)?'decode':part===0?'stageone':'stagetwo');
    log({event:'image-failure',id,file:path.basename(item.source),stage:kind,code,error:description});
    const global=kind!=='decode'&&/ENOSPC|EDQUOT|EACCES|EPERM|EROFS|EIO/.test(code||'')?'disk':/execution provider|model files changed|ONNX Runtime version|manifest is missing|Load model|load_param|load_model|model load|implementation for|Protobuf parsing|InvalidProtobuf|NCNN bridge engine changed/i.test(description)?'model':/out of memory|Insufficient RAM|bad_alloc|E_OUTOFMEMORY|DXGI_ERROR_DEVICE|device lost/i.test(description)?'memory':undefined;
    if(global)fatal(global,-1,error);else if(!['decode','dimensions'].includes(kind)&&++failures[Math.min(part,1)]>=3)fatal('inference-global',-1,error);
    event(id,false,kind,-1);if(!jobFailed)await wait(path.join(control,id+'.final.ack'));active=undefined;stage('RELEASE',id);
   }
  }
 }catch(error){fatal('worker',-1,error);}
 finally{clearInterval(monitor);await runtime.release();}
 process.exitCode=failed?2:0;
}
if(require.main===module)void main().catch(error=>{log({event:'worker-fatal',error:String(error)});process.exitCode=1;});
