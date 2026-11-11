// Actual NCNN/Vulkan inference with tiny, deterministic test-only scalar graphs.
// These graphs are not Manhwa Null and prove protocol/order, not trained quality.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp'),{spawn}=require('node:child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const root=path.resolve(__dirname,'../..'),win=process.platform==='win32';
const engine=process.env.UPSCAYL_TEST_ENGINE||path.join(root,'resources',win?'win':'linux','bin',win?'upscayl-jm.exe':'upscayl-jm');
const icd=path.join(root,'node_modules/electron/dist/vk_swiftshader_icd.json');
function end(m){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{void m.cancel();reject(Error('two-stage test timeout'));},480000);m.once('settled',()=>{clearTimeout(timer);resolve();});});}
function corruptPixelStream(encoded){
 // Truncation is decoder-dependent: WIC accepts the old 63-byte fixture.
 // Keep the PNG/chunk CRCs valid, but use the reserved DEFLATE block type 3.
 // Header readers still see 8x8; every conforming pixel decoder must fail.
 const broken=Buffer.from(encoded);
 for(let offset=8;offset+12<=broken.length;){
  const length=broken.readUInt32BE(offset);assert(offset+12+length<=broken.length);
  if(broken.toString('ascii',offset+4,offset+8)==='IDAT'){
   assert(length>=3);broken[offset+10]=7;
   let crc=0xffffffff;for(const byte of broken.subarray(offset+4,offset+8+length)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
   broken.writeUInt32BE((crc^0xffffffff)>>>0,offset+8+length);return broken;
  }
  offset+=12+length;
 }
 throw Error('Fixture must contain PNG pixel data');
}
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
for(const two of [false,true])test(`${two?'two-stage':'single-model'} 1000 jobs with corrupt image 50: 999 complete, report and repaired-source recovery`,{timeout:500000},async t=>{
 const f=await fixture(t,1000),m=f.make();
 if(!two){delete f.settings.useTwoModels;delete f.settings.secondModel;}
 const broken=path.join(f.source,'0049.png'),encoded=fs.readFileSync(broken);fs.writeFileSync(broken,corruptPixelStream(encoded));
 const header=await sharp(broken).metadata();assert.equal(header.width,8,'corrupt fixture must reach native decode, not preparation rejection');
 await assert.rejects(()=>sharp(broken).raw().toBuffer(),/IDAT|inflate|corrupt|decode|stream/i,'fixture must have invalid pixels, not just a missing optional trailer');
 let active=0,peak=0,admitted=0,released=0,progressive=false;
 m.on('native-trace',e=>{if(e.event==='ADMIT'){assert.equal(active,0);active++;peak=Math.max(active,peak);admitted++;}if(e.event==='RELEASE'){assert.equal(m.snapshot().completed+m.snapshot().failed,released+1,'no release before durable final adoption or recorded image failure');released++;active--;}});
 m.on('state',s=>{if(s.completed>0&&s.completed<1000)progressive=true;});
 const done=end(m);await m.create(f.settings,f.models,engine);await done;
 assert.equal(m.session.phase,'completed-with-errors',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().completed,999);assert.equal(m.snapshot().failed,1);if(two){assert.equal(admitted,1000);assert.equal(released,1000);assert.equal(peak,1);}assert(progressive);assert.equal(f.launches(),1);
 for(const item of [m.session.items[0],m.session.items[999]]){const {data,info}=await sharp(path.join(m.session.output,item.name)).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,8);assert.equal(info.height,8);assert(data.every(v=>two?v>=75&&v<=77:v>=49&&v<=51),'ordered model stages must match the expected pixels');}
 const events=fs.readFileSync(path.join(f.folder,'logs','batch-'+m.session.id+'.log'),'utf8').trim().split('\n').map(JSON.parse);if(two)assert(events.some(e=>e.kind==='stderr'&&/model-load-total first=1 second=1/.test(e.data)));
 const report=fs.readFileSync(m.session.report,'utf8');assert.match(report,/Successful: 999/);assert.match(report,/Failed: 1/);assert.match(report,/0049\.png/);assert(!fs.existsSync(path.join(f.source,'upscayl_batch_report.txt')));assert(fs.existsSync(m.session.file));
 m.removeAllListeners('native-trace');const times=[m.session.items[0],m.session.items[999]].map(item=>[item.name,fs.statSync(path.join(m.session.output,item.name)).mtimeMs]);
 fs.writeFileSync(broken,encoded);let retried=0;m.on('inference-start',()=>retried++);const resumed=end(m);await m.resume();await resumed;assert.equal(m.session.phase,'completed',JSON.stringify(m.snapshot()));assert.equal(retried,two?2:1);for(const [name,time]of times)assert.equal(fs.statSync(path.join(m.session.output,name)).mtimeMs,time);assert.equal(m.snapshot().completed,1000);assert.match(fs.readFileSync(m.session.report,'utf8'),/Failed: 0/);
 console.log(`${two?'Two-stage, capacity=1, model loads=1+1':'Single-model legacy pipeline, one worker process'}: corrupt image 50 skipped, 999 valid, 1 failed; repaired image then resumed alone. Software Vulkan, not GPU performance.`);
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
test('host checkpoint rejection releases the failed image and native worker continues',{timeout:120000},async t=>{
 const f=await fixture(t,4),m=f.make(),checkpoint=require('../../export/electron/jobs/two-stage.js'),original=checkpoint.validateCheckpointImage;let injected=false;const second=[];
 checkpoint.validateCheckpointImage=async(file,dimensions)=>{if(!injected&&file.endsWith('.pending.png')){injected=true;throw Error('Fixture corrupt checkpoint');}return original(file,dimensions);};t.after(()=>checkpoint.validateCheckpointImage=original);
 m.on('native-trace',e=>{if(e.event==='STAGE2')second.push(e.id);});const done=end(m);await m.create(f.settings,f.models,engine);await done;assert.equal(m.session.phase,'completed-with-errors',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().completed,3);assert.equal(m.snapshot().failed,1);assert(!second.includes(0));assert(fs.existsSync(m.session.report));
});
for(const stage of [1,2])test(`three repeated native stage ${stage} geometry failures stop the broken job`,{timeout:120000},async t=>{
 const f=await fixture(t,5),id=stage===1?'test-1x-half':'test-1x-add';fs.writeFileSync(path.join(f.models,id+'.param'),'7767517\n2 2\nInput input 0 1 data\nCrop crop 1 1 data output 0=0 1=0 2=0 3=1 4=1 5=3\n');
 const m=f.make(),second=[];m.on('native-trace',e=>{if(e.event==='STAGE2')second.push(e.id);});const done=end(m);await m.create(f.settings,f.models,engine);await done;assert.equal(m.session.phase,'failed',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().completed,0);assert.equal(m.snapshot().failed,3);assert.equal(m.session.items.filter(i=>i.state==='pending').length,2);if(stage===1)assert.deepEqual(second,[]);assert.equal(m.snapshot().failure.stage,'inference-global');
});
test('native checkpoint ENOSPC is a job fault, closes admission and cannot hang waiting for ACK',{timeout:120000,skip:win?'Linux /dev/full injection; physical Windows disk-full remains a separate acceptance test.':false},async t=>{
 const f=await fixture(t,4),m=f.make();m.on('native-trace',e=>{if(e.event==='STAGE1'&&e.id===0){const file=path.join(path.dirname(m.session.file),'intermediates','0.png.pending.png');fs.symlinkSync('/dev/full',file);}});const done=end(m);await m.create(f.settings,f.models,engine);await done;assert.equal(m.session.phase,'failed',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().completed,0);assert.equal(m.snapshot().failed,1);assert.equal(m.snapshot().failure.stage,'disk');assert(m.session.items.some(i=>i.state==='pending'));await m.cancel();
});
test('single-model repeated inference failures stop the job instead of iterating the whole folder',{timeout:120000},async t=>{
 const f=await fixture(t,5);delete f.settings.useTwoModels;delete f.settings.secondModel;fs.writeFileSync(path.join(f.models,'test-1x-half.param'),'7767517\n2 2\nInput input 0 1 data\nCrop crop 1 1 data output 0=0 1=0 2=0 3=1 4=1 5=3\n');const m=f.make(),done=end(m);await m.create(f.settings,f.models,engine);await done;assert.equal(m.session.phase,'failed',JSON.stringify(m.snapshot()));assert.equal(m.snapshot().completed,0);assert.equal(m.snapshot().failed,3);assert.equal(m.snapshot().failure.stage,'inference-global');assert(m.session.items.some(item=>item.state==='pending'));
});
test('unsafe 4X→4X long page is rejected before inference allocation',()=>{
 const {twoStageDimensions}=require('../../export/electron/jobs/two-stage.js');assert.throws(()=>twoStageDimensions([720,35100],{model:'upscayl-standard-4x',secondModel:'high-fidelity-4x',scale:'2',useCustomWidth:false}),/Unsafe/);
});
