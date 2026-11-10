// Real NCNN model inference on Electron's signed/checksummed SwiftShader distribution.
// Functional correctness only: CPU software Vulkan, never a performance/GPU benchmark.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const sharp=require('sharp');
const {spawn}=require('node:child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const root=path.resolve(__dirname,'../..');
const win=process.platform==='win32';
const engine=path.join(root,'resources',win?'win':'linux','bin',win?'upscayl-jm.exe':'upscayl-jm');
const icd=path.join(root,'node_modules/electron/dist/vk_swiftshader_icd.json');
assert(fs.existsSync(icd),'Electron software Vulkan ICD is required, no silent test skip');
function wait(m) {return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{m.cancel();reject(Error('Native functional test timed out'));},600000);m.once('settled',()=>{clearTimeout(timer);resolve();});});}
async function fixture(t,count,model='upscayl-lite-4x') {
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm3-native-'));
 // Retain failure logs in CI; no source images are included in diagnostics.
 t.after(()=>{const dest=path.join(root,'.test-artifacts/native');fs.mkdirSync(dest,{recursive:true});const logs=path.join(folder,'logs');if(fs.existsSync(logs))for(const name of fs.readdirSync(logs))fs.copyFileSync(path.join(logs,name),path.join(dest,name));fs.rmSync(folder,{recursive:true,force:true});});
 const source=path.join(folder,'漫画 العربية %! Chapter 1');fs.mkdirSync(source);
 for(let i=0;i<count;i++) {
  const image=sharp({create:{width:8,height:8,channels:3,background:{r:100+i,g:70,b:40}}});
  await image.toFile(path.join(source,`${String(i).padStart(3,'0')}.${i%2?'jpg':'png'}`));
 }
 const settings={batchFolderPath:source,outputPath:folder,model,gpuId:'0',saveImageAs:'png',scale:'5',compression:'0',tileSize:32,ttaMode:false,useCustomWidth:false,customWidth:'',copyMetadata:false,noImageProcessing:false};
 const make=()=>{
  const manager=new BatchManager(path.join(folder,'registry'),undefined,(exe,args)=>{
   let executable=exe;
   if(win) {
    // SwiftShader supports direct linking as vulkan-1.dll. Keep this alias in
    // an isolated test-only executable directory: the SDK 1.4 loader asks this
    // older NCNN to request a version its bundled SwiftShader ICD rejects.
    // Neither the production engine directory nor the delivery is modified.
    const runtime=fs.mkdtempSync(path.join(folder,'software-vulkan-'));
    executable=path.join(runtime,path.basename(exe));fs.copyFileSync(exe,executable);
    for(const name of fs.readdirSync(path.dirname(exe)))if(name.endsWith('.dll'))fs.copyFileSync(path.join(path.dirname(exe),name),path.join(runtime,name));
    fs.copyFileSync(path.join(root,'node_modules/electron/dist/vk_swiftshader.dll'),path.join(runtime,'vulkan-1.dll'));
   }
   return spawn(executable,args,{windowsHide:true,env:{...process.env,VK_ICD_FILENAMES:icd,VK_DRIVER_FILES:icd}});
  });
  manager.on('problem',e=>console.log('Native process problem:',String(e)));
  manager.on('settled',()=>{if(manager.session.phase==='failed') {
   const events=fs.readFileSync(path.join(folder,'logs','batch-'+manager.session.id+'.log'),'utf8').trim().split('\n').map(JSON.parse);
   console.log('Native failure evidence:',JSON.stringify(events.filter(e=>e.kind==='exit'||e.kind==='stderr').slice(-3)));
  }});
  return manager;
 };
 return {folder,source,settings,make};
}

test('six real JPG/PNG inputs with High Fidelity and 5x output on software Vulkan',{timeout:1260000},async t=>{
 const f=await fixture(t,6,'high-fidelity-4x');const manager=f.make();
 if(process.env.JM2_REFERENCE_ENGINE) {
  const previous=f.make();const previousEnd=wait(previous);
  await previous.create(f.settings,path.join(root,'resources/models'),process.env.JM2_REFERENCE_ENGINE);await previousEnd;
  const reference={phase:previous.session.phase,completed:previous.snapshot().completed,error:previous.snapshot().lastError};
  console.log('Actual jm.2 reference on software Vulkan:',JSON.stringify(reference));
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n### jm.2 regression comparison (software Vulkan)\n```json\n'+JSON.stringify(reference,null,2)+'\n```\n');
 }
 const end=wait(manager);await manager.create(f.settings,path.join(root,'resources/models'),engine);await end;
 assert.equal(manager.session.phase,'completed',JSON.stringify(manager.snapshot()));
 assert.equal(manager.session.items.filter(i=>i.state==='completed').length,6);
 for(const i of manager.session.items){const info=await sharp(path.join(manager.session.output,i.name)).metadata();assert.equal(info.width,40);assert.equal(info.height,40);}
 assert(fs.readdirSync(manager.session.output).every(n=>n.endsWith('.png')));
 console.log('Real NCNN inference: six images passed with SwiftShader CPU Vulkan. NVIDIA GPU NOT tested.');
});

for(const [count,model] of [[6,'high-fidelity-4x'],[50,'upscayl-lite-4x']]) {
 test(`${count} native images: inference gate drops prefetched work and recovery skips completed`,{timeout:660000},async t=>{
  const f=await fixture(t,count,model),manager=f.make();let requested=false,gate;
  const events=[];
  manager.on('native-trace',e=>{
   events.push(e);
   if(e.event==='END'&&!requested){requested=true;manager.pause();manager.pause();}
  });
  manager.on('gate-closed',e=>{gate=e;events.push({event:'GATE'});});
  const ended=wait(manager);await manager.create(f.settings,path.join(root,'resources/models'),engine);await ended;
  assert(requested&&gate,'The engine must acknowledge the gate, not merely receive Pause');
  assert.equal(manager.session.phase,'paused',JSON.stringify(manager.snapshot()));assert(!manager.child);
  assert.equal(manager.snapshot().engineStopped,true);
  const eventsOnDisk=fs.readFileSync(path.join(f.folder,'logs','batch-'+manager.session.id+'.log'),'utf8').trim().split('\n').map(JSON.parse);
  const pid=eventsOnDisk.find(e=>e.kind==='spawn').data.pid;
  const {ownsEngine}=require('../../export/electron/jobs/process-owner.js');
  assert(!ownsEngine(pid,path.join(manager.session.output,'.upscayl-session','work')),'OS must confirm that this engine is gone');
  const cut=events.findIndex(e=>e.event==='GATE');
  assert(!events.slice(cut+1).some(e=>e.event==='START'),'No inference can start after acknowledged gate closure');
  assert(events.some(e=>e.event==='DEFER'),'Already loaded tasks must be discarded without inference');
  const done=manager.session.items.filter(i=>i.state==='completed');assert(done.length>0&&done.length<count);
  const started=new Set(events.filter(e=>e.event==='START').map(e=>e.id));
  assert.equal(done.length,started.size,'Every started image must finish saving and validation');
  assert(manager.session.items.every(i=>['completed','pending'].includes(i.state)));
  const times=done.map(i=>[i.name,fs.statSync(path.join(manager.session.output,i.name)).mtimeMs]);
  const output=manager.session.output;
  const recovered=f.make();assert.equal(recovered.discover(f.source)[0].id,manager.session.id);
  const finished=wait(recovered);await recovered.restore(manager.session.id);await finished;
  assert.equal(recovered.session.phase,'completed',JSON.stringify(recovered.snapshot()));assert.equal(recovered.session.output,output);
  for(const [name,time]of times)assert.equal(fs.statSync(path.join(output,name)).mtimeMs,time);
  assert(fs.readdirSync(output).every(n=>n.endsWith('.png')));
  const result={count,completedAtPause:done.length,remaining:count-done.length,activeAtGate:gate.active,gateLatencyMs:gate.latencyMs,startsAfterGate:0,engineStopped:true};
  console.log('jm.3 inference-gate evidence:',JSON.stringify(result));
  fs.writeFileSync(path.join(root,'.test-artifacts',`gate-${count}.json`),JSON.stringify(result,null,2));
 });
}

test('STOP cancels the real native child and retains only validated adopted images',{timeout:660000},async t=>{
 const f=await fixture(t,32);const manager=f.make();let requested=false;
 manager.on('state',s=>{if(s.phase==='running'&&s.completed>=1&&!requested){requested=true;manager.cancel();}});
 const end=wait(manager);await manager.create(f.settings,path.join(root,'resources/models'),engine);await end;
 assert(requested);assert.equal(manager.session.phase,'cancelled');assert(!manager.child);
 const done=manager.session.items.filter(i=>i.state==='completed');assert(done.length>0&&done.length<32);
 for(const i of done) {const info=await sharp(path.join(manager.session.output,i.name)).metadata();assert.equal(info.width,40);assert.equal(info.height,40);}
 assert(!fs.existsSync(manager.session.file));assert.deepEqual(manager.discover(),[]);assert(!fs.existsSync(path.join(manager.session.output,'.upscayl-session','work')));
 console.log('Native STOP cancellation passed on software Vulkan; no GPU claim.');
});
