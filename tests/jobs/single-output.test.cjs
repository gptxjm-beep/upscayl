// Real single-image callback + validation/adoption; mock only Electron and the child process.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module'),{EventEmitter}=require('events'),sharp=require('sharp');
const root=path.resolve(__dirname,'../..');
test('Single reports success only for a zero-exit, fully validated, atomically adopted output',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-single-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const input=path.join(folder,'صورة %20 source.png');await sharp({create:{width:4,height:6,channels:3,background:'red'}}).png().toFile(input);
 const sent=[];let spawned,command,enhanced,spawns=0;const config={stopped:false,setChildProcesses(){},setStopped(value){config.stopped=value;}};
 const window={webContents:{send:(...args)=>sent.push(args)},setProgressBar(){}};
 const mocks={
  'electron/utils/get-resource-paths.js':{modelsPath:folder},'electron/utils/config-variables.js':config,
  'electron/utils/spawn-upscayl.js':{spawnUpscayl:(args,_log,flag)=>{spawns++;command=args;enhanced=flag;const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};spawned=child;return {process:child,kill:()=>{}};}},
  'electron/main-window.js':{getMainWindow:()=>window},'electron/utils/logit.js':{__esModule:true,default:()=>{}},
  'electron/utils/show-notification.js':{__esModule:true,default:()=>{}},'electron/utils/copy-metadata.js':{copyMetadata:async()=>{}},
  'electron/utils/get-device-specs.js':{getPlatform:()=>process.platform==='win32'?'win':'linux'},
 };
 const load=Module._load;Module._load=function(request,parent,isMain){let resolved;try{resolved=Module._resolveFilename(request,parent);}catch{};const key=resolved&&path.relative(path.join(root,'export'),resolved).replace(/\\/g,'/');if(mocks[key])return mocks[key];return load.apply(this,arguments);};
 let handler;try{handler=require('../../export/electron/commands/image-upscayl.js').default;}finally{Module._load=load;}
 const settings={imagePath:input,outputPath:folder,model:'upscayl-standard-4x',scale:'2',gpuId:'0',saveImageAs:'png',overwrite:false,useCustomWidth:false,tileSize:32,compression:'0',copyMetadata:false};
 const final=path.join(folder,'صورة %20 source_upscayl_2x_upscayl-standard-4x.png');
 for(const mode of ['nonzero','partial','stopped','success']){
  sent.length=0;await handler(null,settings);const temp=command[command.indexOf('-o')+1];assert.notEqual(temp,final);assert.equal(enhanced,true);assert.equal(command[command.indexOf('-i')+1],input);
  if(mode==='partial'||mode==='stopped')fs.writeFileSync(temp,'incomplete PNG');else await sharp(input).resize(8,12).png().toFile(temp);
  if(mode==='stopped')config.stopped=true;
  await spawned.listeners('close')[0](mode==='nonzero'?2:0,null);
  assert.equal(fs.existsSync(temp),false,'Own temporary file is cleaned');
  assert.equal(sent.filter(x=>x[0]==='Upscaling Done').length,mode==='success'?1:0);
  assert.equal(fs.existsSync(final),mode==='success');
 }
 const count=spawns;sent.length=0;await handler(null,settings);assert.equal(spawns,count);assert(sent.some(x=>x[0]==='Upscaling Done'),'Valid cached file may be reused');
 fs.writeFileSync(final,'broken existing file');sent.length=0;await handler(null,settings);assert.equal(spawns,count);assert(!sent.some(x=>x[0]==='Upscaling Done'));assert.equal(fs.readFileSync(final,'utf8'),'broken existing file');
});
