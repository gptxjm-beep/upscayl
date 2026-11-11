const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const os=require('os');
const {spawn}=require('child_process');
const sharp=require('sharp');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const {atomicJSON,readJSON,hash}=require('../../export/electron/jobs/store.js');
const fake=path.join(__dirname,'fake-engine.cjs');
const delay=ms => new Promise(r => setTimeout(r,ms));
function settled(m) {return new Promise((resolve,reject) => {const t=setTimeout(()=>reject(Error('test timeout')),180000);m.once('settled',()=>{clearTimeout(t);resolve();});});}
async function fixture(t,count=16,fail=false) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'upscayl-jm-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'漫画 العربية');fs.mkdirSync(source);
 const models=path.join(root,'models');fs.mkdirSync(models);
 for(const ext of ['param','bin']) fs.writeFileSync(path.join(models,'test-4x.'+ext),'fixture');
 const pixel=await sharp({create:{width:2,height:3,channels:3,background:'white'}}).png().toBuffer();
 for(let i=0;i<count;i++) fs.writeFileSync(path.join(source,`${String(i).padStart(4,'0')}${fail && i===2 ? '-fail':''}.png`),pixel);
 fs.writeFileSync(path.join(source,'.upscayl-session'),'not an image');
 const settings={batchFolderPath:source,outputPath:root,model:'test-4x',gpuId:'0',saveImageAs:'png',scale:'1',compression:'0',tileSize:200,ttaMode:false,useCustomWidth:false,customWidth:'',copyMetadata:false,noImageProcessing:false};
 const registry=path.join(root,'registry');
 const make=() => new BatchManager(registry,undefined,(_engine,args)=>spawn(process.execPath,[fake,...args]));
 return {root,source,models,settings,registry,make};
}

test('atomic snapshot checksum fallback recovers previous complete snapshot',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jm-store-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'state');atomicJSON(file,{completed:200});atomicJSON(file,{completed:400});
 assert.equal(readJSON(file).completed,400);
 fs.writeFileSync(file,'partial');assert.equal(readJSON(file).completed,200);
});

test('pipeline pause drains accepted images, repeated pause is idempotent, resume skips completed and cleans',async t=>{
 const f=await fixture(t);const m=f.make();let requested=false;
 m.on('state',s=>{if(s.phase==='running' && s.completed>=1 && !requested){requested=true;m.pause();m.pause();}});
 const stopped=settled(m);await m.create(f.settings,f.models,fake);await stopped;
 assert.equal(m.session.phase,'paused');assert.equal(m.child,undefined);
 const done=m.session.items.filter(i=>i.state==='completed');assert(done.length>=2 && done.length<16);
 const times=new Map(done.map(i=>[i.name,fs.statSync(path.join(m.session.output,i.name)).mtimeMs]));
 const file=m.session.file;const finished=settled(m);await m.resume();await finished;
 assert.equal(m.session.phase,'completed');assert(!fs.existsSync(file));assert.deepEqual(m.discover(),[]);
 for(const [name,time] of times) assert.equal(fs.statSync(path.join(m.session.output,name)).mtimeMs,time);
 assert(fs.readdirSync(m.session.output).every(n=>n.endsWith('.png')));
});

test('restart recovery rejects model/source change and repairs corrupt output without overwrite',async t=>{
 const f=await fixture(t);const m=f.make();let paused=false;
 m.on('state',s=>{if(s.phase==='running' && s.completed===1 && !paused){paused=true;m.pause();}});
 const stop=settled(m);await m.create(f.settings,f.models,fake);await stop;
 const s=m.session;const complete=s.items.find(i=>i.state==='completed');
 const corrupt=path.join(s.output,complete.name);fs.writeFileSync(corrupt,'broken');
 const model=path.join(f.models,'test-4x.bin');fs.writeFileSync(model,'changed');
 const changed=f.make();await assert.rejects(()=>changed.restore(s.id),/changed/);
 fs.writeFileSync(model,'fixture');
 const recovered=f.make();const done=settled(recovered);await recovered.restore(s.id);await done;
 assert.equal(recovered.session.phase,'completed');assert.equal(fs.readFileSync(corrupt,'utf8'),'broken');
 assert.notEqual(recovered.session.items.find(i=>i.source===complete.source).name,complete.name);
});

test('failed image retains journal; confirmed Cancel retains successful files and deletes recovery data',async t=>{
 const f=await fixture(t,12,true);const m=f.make();const stop=settled(m);await m.create(f.settings,f.models,fake);await stop;
 assert.equal(m.session.phase,'completed-with-errors');assert(fs.existsSync(m.session.file));assert(m.session.items.some(i=>i.state==='failed'));
 assert(fs.existsSync(m.session.report));assert.equal(m.snapshot().completed,11);
 assert.match(m.snapshot().lastError,/failed during decode \(code -1\)/);
 const logs=fs.readFileSync(path.join(f.root,'logs','batch-'+m.session.id+'.log'),'utf8').trim().split('\n').map(JSON.parse);
 assert(logs.some(e=>e.kind==='stderr'&&e.data.includes('HRESULT=0x80004005')));
 assert(logs.some(e=>e.kind==='image'&&e.data.stage==='decode'&&e.data.source.endsWith('-fail.png')));
 assert(logs.some(e=>e.kind==='exit'&&e.data.code===2));
 const scale=m.session.settings.scale;m.session.settings.scale='3';
 await assert.rejects(()=>m.resume(),/settings changed/);m.session.settings.scale=scale;
 const adopted=m.session.items.find(i=>i.state==='completed');fs.writeFileSync(adopted.source,'changed'); // completed-source identity stays strict even during failed-image retries
 await assert.rejects(()=>m.resume(),/Source changed/);
 await m.cancel();assert.equal(m.session.phase,'cancelled');assert(!fs.existsSync(m.session.file));assert.deepEqual(m.discover(),[]);
});

test('shutdown during running/pausing persists progress and can be restored',async t=>{
 const f=await fixture(t,24);const m=f.make();await m.create(f.settings,f.models,fake);
 await m.shutdown();assert.equal(m.session.phase,'paused');assert(!m.child);
 const recovered=f.make();const end=settled(recovered);await recovered.restore(m.session.id);await end;
 assert.equal(recovered.session.phase,'completed');
});

test('50 inputs: ledger advances past two checkpoints and recovery retains all independent file states',async t=>{
 const f=await fixture(t,50);const m=f.make();let milestone=10,requested=false;
 m.on('state',s=>{if(s.phase==='running' && s.completed>=milestone && !requested){requested=true;m.pause();}});
 let stop=settled(m);await m.create(f.settings,f.models,fake);await stop;
 const first=m.session.items.filter(i=>i.state==='completed').length;assert(first>=10 && first<25);
 milestone=25;requested=false;stop=settled(m);await m.resume();await stop;
 const recorded=readJSON(m.session.file);const second=recorded.items.filter(i=>i.state==='completed').length;
 assert(second>=25 && second>first);assert.equal(recorded.items.length,50);
 assert.equal(m.discover()[0].completed,second);
});

test('engine crash and interrupted commit reconcile on recovery without reprocessing adopted output',async t=>{
 const f=await fixture(t,12);const m=f.make();await m.create(f.settings,f.models,fake);
 const end=settled(m);m.child.kill();await end;
 assert.equal(m.session.phase,'failed');assert(fs.existsSync(m.session.file));
 // Simulate crash after the no-overwrite link but before Completed journal write.
 const item=m.session.items[0];const final=path.join(m.session.output,item.name);
 await sharp(item.source).toFile(final);
 item.outputHash=await hash(final);item.state='committing';m.session.phase='running';
 atomicJSON(m.session.file,m.session);
 const originalTime=fs.statSync(final).mtimeMs;
 const recovered=f.make();const done=settled(recovered);await recovered.restore(m.session.id);await done;
 assert.equal(recovered.session.phase,'completed');assert.equal(fs.statSync(final).mtimeMs,originalTime);
});

test('Cancel during input preparation never starts an engine',async t=>{
 const f=await fixture(t,12);const m=f.make();
 const preparation=m.create(f.settings,f.models,fake);const cancellation=m.cancel();
 await assert.rejects(()=>preparation,/preparation cancelled/);await cancellation;
 assert.equal(m.child,undefined);assert.equal(m.session,undefined);assert.deepEqual(m.discover(),[]);
});

test('Start From Beginning creates a durable replacement then retires the old record',async t=>{
 const f=await fixture(t,12);const old=f.make();await old.create(f.settings,f.models,fake);
 await old.shutdown();const record=old.session.file,output=old.session.output;
 const fresh=f.make();const done=settled(fresh);await fresh.restart(old.session.id);await done;
 assert.equal(fresh.session.phase,'completed');assert.notEqual(fresh.session.output,output);
 assert(!fs.existsSync(record));assert(fs.existsSync(output));assert.notEqual(fresh.session.id,old.session.id);
});

test('Cancel cannot race a new batch before the previous process has closed',async t=>{
 const f=await fixture(t,12);const m=f.make();await m.create(f.settings,f.models,fake);
 const stopped=settled(m);const cancellation=m.cancel();
 await assert.rejects(()=>m.create(f.settings,f.models,fake),/current batch/);
 await stopped;await cancellation;assert.equal(m.child,undefined);assert.equal(m.session.phase,'cancelled');
 assert(!fs.existsSync(m.session.file));
});

for(const stage of ['waiting','inference','saving','committing','adopted'])test(`host killed during ${stage}: recovery reconciles only proven outputs`,async t=>{
 const f=await fixture(t,12),signal=path.join(f.root,'checkpoint.json'),config=path.join(f.root,'host.json');
 fs.writeFileSync(config,JSON.stringify({stage,signal,registry:f.registry,settings:f.settings,models:f.models,engine:fake}));
 const host=spawn(process.execPath,[path.join(__dirname,'crash-host.cjs'),config],{stdio:['ignore','ignore','pipe']});let diagnostics='';host.stderr.on('data',data=>{diagnostics=(diagnostics+data).slice(-4000);});
 t.after(()=>{if(host.exitCode===null)host.kill('SIGKILL');});
 const deadline=Date.now()+30000;
 while(!fs.existsSync(signal)){assert.equal(host.exitCode,null,'Crash fixture exited before checkpoint: '+diagnostics);assert(Date.now()<deadline,'Host did not reach checkpoint: '+diagnostics);await delay(10);}
 const evidence=JSON.parse(fs.readFileSync(signal,'utf8'));
 const exited=new Promise(resolve=>host.once('close',resolve));host.kill('SIGKILL');await exited;
 const {ownsEngine}=require('../../export/electron/jobs/process-owner.js');
 while(ownsEngine(evidence.pid,evidence.session.attempt)){assert(Date.now()<deadline,'Orphan engine failed to stop');await delay(50);}
 if(stage==='saving') {
  const unfinished=fs.readdirSync(evidence.session.attempt).find(n=>n.endsWith('.png'));
  assert(unfinished);fs.writeFileSync(path.join(evidence.session.attempt,unfinished),'partial unflushed image');
 }
 const original=evidence.session.items.find(i=>i.outputHash);
 const output=original&&path.join(evidence.session.output,original.name);
 const stamp=output&&fs.existsSync(output)?fs.statSync(output).mtimeMs:undefined;
 const recovered=f.make(),finished=settled(recovered);await recovered.restore(evidence.session.id);await finished;
 assert.equal(recovered.session.phase,'completed');
 assert.equal(recovered.session.items.filter(i=>i.state==='completed').length,12);
 if(stamp!==undefined)assert.equal(fs.statSync(output).mtimeMs,stamp,'Proven adopted image was processed twice');
 assert(fs.readdirSync(recovered.session.output).every(n=>n.endsWith('.png')));
});

test('a reused PID does not block recovery of an unrelated stopped engine',async t=>{
 const f=await fixture(t,12),old=f.make();await old.create(f.settings,f.models,fake);await old.shutdown();
 old.session.pid=process.pid;atomicJSON(old.session.file,old.session);
 const recovered=f.make(),done=settled(recovered);await recovered.restore(old.session.id);await done;
 assert.equal(recovered.session.phase,'completed');
});

test('valid but unproven final file is preserved and retry gets a separate name',async t=>{
 const f=await fixture(t,12),old=f.make();await old.create(f.settings,f.models,fake);await old.shutdown();
 const item=old.session.items.find(i=>i.state!=='completed');const final=path.join(old.session.output,item.name);
 await sharp(item.source).toFile(final);const stamp=fs.statSync(final).mtimeMs;
 const recovered=f.make(),done=settled(recovered);await recovered.restore(old.session.id);await done;
 assert.equal(recovered.session.phase,'completed');assert.equal(fs.statSync(final).mtimeMs,stamp);
 assert.notEqual(recovered.session.items.find(i=>i.source===item.source).name,item.name);
});

test('unresponsive inference has a bounded shutdown and retains recovery state',async t=>{
 const f=await fixture(t,12),manager=f.make();
 manager.launch=()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
 await manager.create(f.settings,f.models,fake);await manager.shutdown(40);
 assert(!manager.child);assert.equal(manager.session.phase,'failed');assert(fs.existsSync(manager.session.file));
 assert.equal(manager.snapshot().engineStopped,true);
});

test('cancel intent survives a crash before cleanup and cannot be resumed',async t=>{
 const f=await fixture(t,12),old=f.make();await old.create(f.settings,f.models,fake);await old.shutdown();
 const finals=old.session.items.filter(i=>i.state==='completed').map(i=>path.join(old.session.output,i.name));
 old.session.phase='cancelled';old.session.cancelConfirmed=true;atomicJSON(old.session.file,old.session);
 const recovered=f.make();assert.deepEqual(recovered.discover(),[]);assert(!fs.existsSync(old.session.file));
 for(const file of finals)assert(fs.existsSync(file));
 await assert.rejects(()=>recovered.restore(old.session.id),/unreadable/);
});

test('failed Start From Beginning retains the previous durable journal',async t=>{
 const f=await fixture(t,12),old=f.make();await old.create(f.settings,f.models,fake);await old.shutdown();
 const before=fs.readFileSync(old.session.file);fs.unlinkSync(path.join(f.models,'test-4x.param'));
 await assert.rejects(()=>f.make().restart(old.session.id));assert.deepEqual(fs.readFileSync(old.session.file),before);
});

test('a cancellation journal-write failure never leaves the engine running',async t=>{
 const f=await fixture(t,12),manager=f.make();await manager.create(f.settings,f.models,fake);
 const save=manager.save.bind(manager);let injected=false;
 manager.save=()=>{if(manager.session.phase==='cancelled'&&!injected){injected=true;throw Error('injected disk-full');}save();};
 await manager.cancel();assert(injected);assert(!manager.child);assert(!fs.existsSync(manager.session.file));
});

test('cleanup failure retains permanent cancellation intent and cannot resume',async t=>{
 const f=await fixture(t,12),manager=f.make();await manager.create(f.settings,f.models,fake);await manager.shutdown();
 manager.removeSession=()=>{throw Error('injected sharing violation');};
 await assert.rejects(()=>manager.cancel(),/sharing violation/);
 assert.equal(readJSON(manager.session.file).cancelConfirmed,true);
 await assert.rejects(()=>f.make().restore(manager.session.id),/permanently cancelled/);
 const next=f.make();assert.deepEqual(next.discover(),[]);assert(!fs.existsSync(manager.session.file));
});

test('restore and start-over both reject a still-owned engine process',async t=>{
 const f=await fixture(t,12),old=f.make();
 old.launch=(_engine,args)=>spawn(process.execPath,['-e','setInterval(()=>{},1000)','--',...args]);
 await old.create(f.settings,f.models,fake);
 try {
  await assert.rejects(()=>f.make().restore(old.session.id),/still active/);
  await assert.rejects(()=>f.make().restart(old.session.id),/still active/);
 }finally{await old.cancel();}
});

test('closing during Resume preflight never launches another engine',async t=>{
 const f=await fixture(t,12),manager=f.make();let asked=false;
 manager.on('state',s=>{if(s.phase==='running'&&s.completed>=1&&!asked){asked=true;manager.pause();}});
 const paused=settled(manager);await manager.create(f.settings,f.models,fake);await paused;
 let enter,release;const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r);
 const modelHash=manager.modelHash.bind(manager);
 manager.modelHash=async (...args)=>{enter();await hold;return modelHash(...args);};
 let launches=0;manager.launch=()=>{launches++;throw Error('Engine must not launch during close');};
 const resuming=manager.resume();await entered;const closing=manager.shutdown();release();
 await resuming;await closing;assert.equal(launches,0);assert(!manager.child);
 assert.equal(manager.session.phase,'paused');assert(fs.existsSync(manager.session.file));
});

test('legacy Pause engine cannot be restored silently; start-over uses the supplied current engine',async t=>{
 const f=await fixture(t,12),old=f.make();await old.create(f.settings,f.models,fake);await old.shutdown();
 const legacy=path.join(f.root,'legacy-engine');fs.writeFileSync(legacy,'old loader-only engine');
 old.session.engine=legacy;old.session.engineHash=await hash(legacy);atomicJSON(old.session.file,old.session);
 const before=fs.readFileSync(old.session.file),oldOutput=old.session.output;
 await assert.rejects(()=>f.make().restore(old.session.id),/older Pause protocol/);
 assert.deepEqual(fs.readFileSync(old.session.file),before);
 const fresh=f.make(),end=settled(fresh);await fresh.restart(old.session.id,fake,f.models);await end;
 assert.equal(fresh.session.phase,'completed');assert.equal(fresh.session.engine,fake);
 assert.notEqual(fresh.session.output,oldOutput);assert(fs.existsSync(oldOutput));
});


test('fresh run uses current settings and preserves old adopted output bytes',async t=>{
 const f=await fixture(t,12),old=f.make();let paused=false;
 old.on('state',s=>{if(s.completed>=1&&!paused){paused=true;old.pause();}});
 const ended=settled(old);await old.create(f.settings,f.models,fake);await ended;
 const adopted=old.session.items.filter(i=>i.state==='completed').map(i=>[path.join(old.session.output,i.name),fs.readFileSync(path.join(old.session.output,i.name))]);
 assert(adopted.length>0);const previousId=old.session.id;
 const current={...f.settings,scale:'2',saveImageAs:'jpg',tileSize:64,ttaMode:true};
 const next=f.make(),done=settled(next);
 const watchdog=setTimeout(()=>{
  console.error('Fresh JPG diagnostic:',JSON.stringify(next.snapshot()),JSON.stringify(next.session?.items.filter(i=>i.error).map(i=>({name:i.name,error:i.error}))));
  void next.cancel().catch(console.error);
 },15000);t.after(()=>clearTimeout(watchdog));
 await next.restart(previousId,fake,f.models,current);await next.whenStarted();await done;clearTimeout(watchdog);
 assert.equal(next.session.phase,'completed');assert.deepEqual(next.session.settings,current);
 for(const item of next.session.items){const info=await sharp(path.join(next.session.output,item.name)).metadata();assert.equal(info.width,4);assert.equal(info.height,6);assert.equal(info.format,'jpeg');}
 for(const [file,bytes]of adopted)assert.deepEqual(fs.readFileSync(file),bytes);
 assert(!next.discover().some(s=>s.id===previousId));
});

test('clean shutdown marker persists; starting inference resets it to open',async t=>{
 const f=await fixture(t,12),m=f.make();await m.create(f.settings,f.models,fake);await m.whenStarted();await m.shutdown();
 assert.equal(readJSON(m.session.file).shutdown,'clean');assert.equal(m.discover()[0].shutdown,'clean');
 const next=f.make(),done=settled(next);await next.restore(m.session.id);await next.whenStarted();assert.equal(readJSON(next.session.file).shutdown,'open');await done;
});

test('a relocated identical engine and model can resume; arbitrary changed engines cannot',async t=>{
 const f=await fixture(t,12),m=f.make();await m.create(f.settings,f.models,fake);await m.shutdown();
 const relocated=path.join(f.root,'relocated.cjs');fs.copyFileSync(fake,relocated);
 const record=readJSON(m.session.file);record.engine=path.join(f.root,'gone.cjs');atomicJSON(m.session.file,record);
 const bad=path.join(f.root,'unknown.cjs');fs.writeFileSync(bad,'// @JM3 GATE changed');
 await assert.rejects(()=>f.make().restore(record.id,bad,f.models),/no verified compatible upgrade/);
 const next=f.make(),done=settled(next);await next.restore(record.id,relocated,f.models);await done;assert.equal(next.session.phase,'completed');
});
