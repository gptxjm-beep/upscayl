const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {BatchPrompts,startupRecoverable}=require('../../export/electron/jobs/prompts.js');
const {writeBatchEvent,pruneBatchLogs}=require('../../export/electron/jobs/log.js');
const {describeFailure,significantEngineLine}=require('../../export/electron/jobs/failure.js');
const session={id:'saved-job',source:'C:/Manga/Chapter',output:'C:/Results',completed:35,total:100,phase:'running',settings:{model:'upscayl-standard-4x',scale:'2',saveImageAs:'png'}};

test('startup reminders distinguish interrupted, clean paused and terminal sessions',()=>{
 for(const phase of ['running','pausing','preparing','resuming','recovering','failed'])assert(startupRecoverable({...session,phase}));
 assert(startupRecoverable({...session,phase:'paused',shutdown:'open'}));
 assert(!startupRecoverable({...session,phase:'paused'}),'Legacy paused metadata is not proof of an abnormal exit');
 assert(!startupRecoverable({...session,phase:'paused',shutdown:'clean'}));
 for(const phase of ['completed','cancelled'])assert(!startupRecoverable({...session,phase,shutdown:'open'}));
});

test('recovery remains visible and busy until execution starts, duplicate and stale actions fail',async()=>{
 const broker=new BatchPrompts();let release,calls=0;const gate=new Promise(r=>release=r);
 const answered=broker.open({kind:'folder',session,currentSettings:{...session.settings,model:'high-fidelity-4x',scale:'4'}},async choice=>{calls++;assert.equal(choice,'fresh');await gate;});
 const token=broker.current.token;
 const first=broker.act(token,'fresh');assert.equal(broker.current.busy,true);
 assert.equal((await broker.act(token,'fresh')).ok,false);assert.equal(calls,1);
 assert.equal(broker.current.session.settings.scale,'2');assert.equal(broker.current.currentSettings.scale,'4');
 release();assert.equal((await first).ok,true);assert.equal(await answered,'fresh');assert.equal(broker.current,null);
 assert.equal((await broker.act(token,'fresh')).ok,false);
});

test('Not Now dismisses only the reminder; folder recovery can be offered later',async()=>{
 const broker=new BatchPrompts(),before=JSON.stringify(session);let dismissals=0;
 let done=broker.open({kind:'startup',session},async choice=>{assert.equal(choice,'dismiss');dismissals++;});
 assert.equal((await broker.act(broker.current.token,'fresh')).ok,false);
 await broker.act(broker.current.token,'dismiss');assert.equal(await done,'dismiss');assert.equal(JSON.stringify(session),before);
 done=broker.open({kind:'folder',session,currentSettings:session.settings},async()=>{});
 assert.equal(broker.current.kind,'folder');await broker.act(broker.current.token,'dismiss');await done;assert.equal(dismissals,1);
});

test('failed recovery retains the offer and exposes a bounded error; retry can succeed',async()=>{
 const broker=new BatchPrompts();let fail=true;
 const done=broker.open({kind:'startup',session},async()=>{if(fail)throw Error('read failure '+'.'.repeat(2000));});
 const token=broker.current.token;assert.equal((await broker.act(token,'resume')).ok,false);
 assert.equal(broker.current.token,token);assert.equal(broker.current.busy,false);assert(broker.current.error.length<=400);
 fail=false;await broker.act(token,'resume');await done;assert.equal(broker.current,null);
});

test('STOP prompt accepts only explicit stop or dismissal and serializes cleanup',async()=>{
 const broker=new BatchPrompts();let stopped=0;
 const done=broker.open({kind:'stop',session},async c=>{if(c==='stop')stopped++;});
 assert.equal((await broker.act(broker.current.token,'resume')).ok,false);
 assert.equal(await broker.open({kind:'startup',session},async()=>{}),null);
 await broker.act(broker.current.token,'dismiss');await done;assert.equal(stopped,0);
 const stop=broker.open({kind:'stop',session},async c=>{if(c==='stop')stopped++;});
 await broker.act(broker.current.token,'stop');await stop;assert.equal(stopped,1);
});

test('logs rotate, retain bounded recent jobs, and leave unrelated files alone',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jm4-logs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const id=crypto.randomUUID();for(let i=0;i<150;i++)writeBatchEvent(dir,id,'warning',{message:'x'.repeat(6000)});
 assert(fs.existsSync(path.join(dir,'batch-'+id+'.log.1')));
 fs.writeFileSync(path.join(dir,'user-notes.log'),'keep me');
 for(let i=0;i<20;i++)writeBatchEvent(dir,crypto.randomUUID(),'start',{count:1000});
 pruneBatchLogs(dir);
 const owned=fs.readdirSync(dir).filter(n=>/^batch-[a-f0-9-]+\.log/.test(n));
 assert(new Set(owned.map(n=>n.replace(/\.1$/,''))).size<=8);
 for(const name of owned){assert(fs.statSync(path.join(dir,name)).size<=256*1024);for(const line of fs.readFileSync(path.join(dir,name),'utf8').trim().split('\n'))if(line)JSON.parse(line);}
 assert.equal(fs.readFileSync(path.join(dir,'user-notes.log'),'utf8'),'keep me');
});

test('WIC size HRESULT is recognized without assuming Pause or an oversized source caused it',()=>{
 const failure=describeFailure('native encode failed','000053.jpg','encode',String(0x88982f51-2**32));
 assert.match(failure.reason,/dimensions/);assert(!/pause/i.test(failure.reason));assert.equal(failure.image,'000053.jpg');
 assert(!significantEngineLine('91.48%'));assert(!significantEngineLine('Upscayled Successfully!'));
 assert(significantEngineLine('[WIC] image=53 width=1440 height=59400 HRESULT=0x88982f51'));
});
