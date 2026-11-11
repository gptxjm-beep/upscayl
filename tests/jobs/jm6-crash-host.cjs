// Test-only process: terminate after the real manager durably commits stage one
// and before it can ACK the worker. No production crash hook is introduced.
const fs=require('fs'),{BatchManager}=require('../../export/electron/jobs/manager.js');
const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),m=new BatchManager(c.registry);
m.on('state',()=>{if(m.session.items[0]?.stage==='stage1-complete'){fs.writeFileSync(c.signal,JSON.stringify({id:m.session.id,pid:m.child.pid,control:m.session.attempt}));process.exit(91);}});
m.create(c.settings,c.models,c.worker,c.models,c.native).catch(e=>{console.error(e);process.exit(1);});
