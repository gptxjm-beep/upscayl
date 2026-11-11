// Test-only separate host, killed externally at a real filesystem checkpoint.
const fs=require('fs'),{spawn}=require('child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const manager=new BatchManager(cfg.registry,undefined,(_exe,args)=>spawn(process.execPath,[cfg.engine,...args],{env:{...process.env,JM_TEST_LEASE_MS:'3000'}}));
let signalled=false;
function stopAt(stage) {
 if(signalled||stage!==cfg.stage)return;signalled=true;
 fs.writeFileSync(cfg.signal+'.new',JSON.stringify({session:manager.session,pid:manager.child?.pid}));fs.renameSync(cfg.signal+'.new',cfg.signal);
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
}
manager.on('native-trace',e=>{if(e.event==='LOAD')stopAt('waiting');if(e.event==='START')stopAt('inference');});
const commit=manager.commit.bind(manager);
manager.commit=async (...args)=>{stopAt('saving');return commit(...args);};
const link=fs.linkSync;
fs.linkSync=(...args)=>{link(...args);stopAt('adopted');};
manager.on('state',()=>{if(manager.session.items.some(i=>i.state==='committing'))stopAt('committing');});
manager.create(cfg.settings,cfg.models,cfg.engine).catch(e=>{console.error(e);process.exit(1);});
