// Actual NCNN/Vulkan inference with tiny, deterministic test-only scalar graphs.
// These graphs are not Manhwa Null and prove protocol/order, not trained quality.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp'),{spawn}=require('node:child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const root=path.resolve(__dirname,'../..'),win=process.platform==='win32';
const engine=process.env.UPSCAYL_TEST_ENGINE||path.join(root,'resources',win?'win':'linux','bin',win?'upscayl-jm.exe':'upscayl-jm');
const icd=path.join(root,'node_modules/electron/dist/vk_swiftshader_icd.json');
function end(m){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{void m.cancel();reject(Error('two-stage test timeout'));},480000);m.once('settled',()=>{clearTimeout(timer);resolve();});});}
async function fixture(t,count=4){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-two-')),source=path.join(folder,'漫画 العربية'),models=path.join(folder,'models');fs.mkdirSync(source);fs.mkdirSync(models);
 t.after(()=>{const dest=path.join(root,'.test-artifacts/two-stage');fs.mkdirSync(dest,{recursive:true});const logs=path.join(folder,'logs');if(fs.existsSync(logs))for(const n of fs.readdirSync(logs))fs.copyFileSync(path.join(logs,n),path.join(dest,n));fs.rmSync(folder,{recursive:true,force:true});});
 for(const [id,op,value] of [['test-1x-half',2,.5],['test-1x-add',0,.1]]){fs.writeFileSync(path.join(models,id+'.param'),`7767517\n2 2\nInput input 0 1 data\nBinaryOp op 1 1 data output 0=${op} 1=1 2=${value}\n`);fs.writeFileSync(path.join(models,id+'.bin'),'');}
 const image=await sharp({create:{width:8,height:8,channels:3,background:{r:100,g:100,b:100}}}).png().toBuffer();for(let i=0;i<count;i++)fs.writeFileSync(path.join(source,String(i).padStart(4,'0')+'.png'),image);
 const settings={batchFolderPath:source,outputPath:folder,model:'test-1x-half',useTwoModels:true,secondModel:'test-1x-add',gpuId:'0',saveImageAs:'png',scale:'1',compression:'0',tileSize:32,ttaMode:false,useCustomWidth:false,customWidth:'',copyMetadata:false,noImageProcessing:false};
 let launches=0;const make=()=>{
  const m=new BatchManager(path.join(folder,'registry'),undefined,(exe,args)=>{
   launches++;let executable=exe;
   if(win){const dir=fs.mkdtempSync(path.join(folder,'runtime-'));executable=path.join(dir,path.basename(exe));fs.copyFileSync(exe,executable);for(const n of fs.readdirSync(path.dirname(exe)))if(n.endsWith('.dll'))fs.copyFileSync(path.join(path.dirname(exe),n),path.join(dir,n));fs.copyFileSync(path.join(root,'node_modules/electron/dist/vk_swiftshader.dll'),path.join(dir,'vulkan-1.dll'));}
   return spawn(executable,args,{windowsHide:true,env:{...process.env,VK_ICD_FILENAMES:icd,VK_DRIVER_FILES:icd}});
  });m.on('problem',e=>console.log('two-stage diagnostic',String(e)));return m;
 };
 return {folder,source,models,settings,make,launches:()=>launches};
}
test('1000 whole-image jobs: ordered stages, progressive adoption, capacity held until final ACK and two model loads',{timeout:500000},async t=>{
 const f=await fixture(t,1000),m=f.make();let active=0,peak=0,admitted=0,released=0,progressive=false;
 m.on('native-trace',e=>{if(e.event==='ADMIT'){assert.equal(active,0);active++;peak=Math.max(active,peak);admitted++;}if(e.event==='RELEASE'){assert.equal(m.snapshot().completed,released+1,'no release before durable final adoption');released++;active--;}});
 m.on('state',s=>{if(s.completed>0&&s.completed<1000)progressive=true;});
 const done=end(m);await m.create(f.settings,f.models,engine);await done;
 assert.equal(m.session.phase,'completed',JSON.stringify(m.snapshot()));assert.equal(admitted,1000);assert.equal(released,1000);assert.equal(peak,1);assert(progressive);assert.equal(f.launches(),1);
 for(const item of [m.session.items[0],m.session.items[999]]){const {data,info}=await sharp(path.join(m.session.output,item.name)).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,8);assert.equal(info.height,8);assert(data.every(v=>v>=75&&v<=77),'half then add yields ~76; reversed order would yield ~63');}
 const events=fs.readFileSync(path.join(f.folder,'logs','batch-'+m.session.id+'.log'),'utf8').trim().split('\n').map(JSON.parse);assert(events.some(e=>e.kind==='stderr'&&/model-load-total first=1 second=1/.test(e.data)));
 assert(!fs.existsSync(path.join(m.session.output,'.upscayl-session')));
 console.log('1000 actual scalar NCNN jobs passed: capacity=1, model loads=1+1, software Vulkan only.');
});
for(const corrupt of [false,true])test(`pause after durable first stage; recovery ${corrupt?'rebuilds a corrupt checkpoint':'starts from stage two'}`,{timeout:120000},async t=>{
 const f=await fixture(t),m=f.make();let pause=false;m.on('native-trace',e=>{if(e.event==='CHECKPOINT'&&!pause){pause=true;m.pause();}});
 const stopped=end(m);await m.create(f.settings,f.models,engine);await stopped;
 assert.equal(m.session.phase,'paused',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().completed,0);assert(m.snapshot().engineStopped);const record=m.session.items[0].checkpoint;assert(record&&fs.existsSync(record.file));assert.equal(m.session.items[0].stage,'stage1-complete');
 if(corrupt)fs.writeFileSync(record.file,'partial');
 const recovered=f.make(),stages=[];recovered.on('native-trace',e=>{if(e.id===0&&['STAGE1','STAGE2'].includes(e.event))stages.push(e.event);});const done=end(recovered);await recovered.restore(m.session.id,engine,f.models,f.models);await done;
 assert.equal(recovered.session.phase,'completed',JSON.stringify(recovered.snapshot()));assert.deepEqual(stages,corrupt?['STAGE1','STAGE2']:['STAGE2']);
});
test('second-stage failure remains failed with a recoverable first-stage checkpoint',{timeout:120000},async t=>{
 const f=await fixture(t,1);fs.writeFileSync(path.join(f.models,'test-1x-add.param'),'invalid model');const m=f.make(),done=end(m);await m.create(f.settings,f.models,engine);await done;
 assert.equal(m.session.phase,'failed');assert.equal(m.snapshot().completed,0);assert.equal(m.session.items[0].stage,'failed');assert(fs.existsSync(m.session.items[0].checkpoint.file));assert(!fs.existsSync(path.join(m.session.output,m.session.items[0].name)));await m.cancel();assert(!fs.existsSync(m.session.file));
});
for(const stage of ['STAGE1','STAGE2','VERIFY'])test(`pause during ${stage} drains safely and resumes without changing adopted files`,{timeout:120000},async t=>{
 const f=await fixture(t),m=f.make();let paused=false;m.on('native-trace',e=>{if(e.id===0&&e.event===stage&&!paused){paused=true;m.pause();}});
 const stopped=end(m);await m.create(f.settings,f.models,engine);await stopped;assert.equal(m.session.phase,'paused',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().completed,stage==='STAGE1'?0:1);
 const adopted=m.session.items.filter(i=>i.state==='completed').map(i=>[i.name,fs.statSync(path.join(m.session.output,i.name)).mtimeMs]);const done=end(m);await m.resume();await done;assert.equal(m.session.phase,'completed');for(const [name,time]of adopted)assert.equal(fs.statSync(path.join(m.session.output,name)).mtimeMs,time);
});
test('managed Single processes exactly one image, preserving neighboring inputs',{timeout:120000},async t=>{
 const f=await fixture(t,4),m=f.make();f.settings.singleImage=path.join(f.source,'0001.png');const done=end(m);await m.create(f.settings,f.models,engine);await done;assert.equal(m.session.phase,'completed',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().kind,'single');assert.equal(m.snapshot().total,1);assert.equal(m.session.items[0].source,f.settings.singleImage);assert.equal(fs.readdirSync(f.source).length,4);assert.equal(fs.readdirSync(m.session.output).length,1);
});
test('a changed second model rejects recovery and retains the journal/checkpoint',{timeout:120000},async t=>{
 const f=await fixture(t,1),m=f.make();m.on('native-trace',e=>{if(e.event==='CHECKPOINT')m.pause();});const stopped=end(m);await m.create(f.settings,f.models,engine);await stopped;fs.appendFileSync(path.join(f.models,'test-1x-add.param'),'changed');const r=f.make();await assert.rejects(()=>r.restore(m.session.id,engine,f.models,f.models),/Second model changed/);assert(fs.existsSync(m.session.file));assert(fs.existsSync(m.session.items[0].checkpoint.file));
});
test('unacknowledged controller crash retains a durable checkpoint; lease expiry stops the orphan and recovery starts at stage two',{timeout:120000},async t=>{
 const f=await fixture(t,1);const child=spawn(process.execPath,[path.join(__dirname,'two-stage-crash-child.cjs'),f.folder,f.source,f.models,engine],{windowsHide:true,stdio:'ignore'});const code=await new Promise(resolve=>child.once('exit',resolve));assert.equal(code,91);
 const record=JSON.parse(fs.readFileSync(path.join(f.folder,'crashed-session.json'),'utf8')),{ownsEngine}=require('../../export/electron/jobs/process-owner.js');const deadline=Date.now()+45000;while(ownsEngine(record.pid,record.attempt)){assert(Date.now()<deadline,'orphan did not stop after lease expiry');await new Promise(resolve=>setTimeout(resolve,250));}
 const m=f.make(),stages=[];m.on('native-trace',e=>{if(['STAGE1','STAGE2'].includes(e.event))stages.push(e.event);});const done=end(m);await m.restore(record.id,engine,f.models,f.models);await done;assert.equal(m.session.phase,'completed',JSON.stringify(m.snapshot()));assert.deepEqual(stages,['STAGE2']);
});
test('unsafe 4X→4X long page is rejected before inference allocation',()=>{
 const {twoStageDimensions}=require('../../export/electron/jobs/two-stage.js');assert.throws(()=>twoStageDimensions([720,35100],{model:'upscayl-standard-4x',secondModel:'high-fidelity-4x',scale:'2',useCustomWidth:false}),/Unsafe/);
});
