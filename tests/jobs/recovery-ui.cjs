// Real Electron close/relaunch and source-folder discovery. Uses a test-only
// pipeline simulator; real NCNN inference is covered by native-functional.cjs.
const {_electron}=require('playwright-core');
const fs=require('fs'),os=require('os'),path=require('path'),sharp=require('sharp');
const assert=require('node:assert/strict'),{spawn}=require('child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const root=path.resolve(__dirname,'../..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm3-recovery-ui-'));
const source=path.join(folder,'漫画 العربية source'),models=path.join(folder,'models'),profile=path.join(folder,'profile');
const fake=path.join(__dirname,'fake-engine.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const deadline=Date.now()+30000;while(!(await check())){assert(Date.now()<deadline,'Recovery UI timed out');await delay(30);}}
async function open(){
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron'),args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:profile}});
 let diagnostic='';for(const stream of [app.process().stdout,app.process().stderr])stream?.on('data',data=>{diagnostic=(diagnostic+data.toString()).slice(-12000);});
 app.process().on('exit',(code,signal)=>{if(code!==0)console.error('Electron recovery process exit',code,signal,diagnostic);});
 await app.evaluate(({dialog},{root,node,source})=>{
  const req=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const manager=req(root+'/export/electron/jobs/integration.js').batchManager();
  manager.launch=(exe,args)=>req('child_process').spawn(node,[exe,...args],{windowsHide:true,env:{...process.env,NODE_OPTIONS:''}});
  global.recoveryPhase=()=>manager.snapshot()?.phase;
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});
 },{root,node:process.execPath,source});
 const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
 try{await page.getByRole('button',{name:'Close',exact:true}).click({timeout:5000});}catch{}
 await page.getByRole('button',{name:'Resume Processing',exact:true}).waitFor();
 await page.getByRole('button',{name:'Not Now',exact:true}).click();
 await page.getByRole('button',{name:'Resume Processing',exact:true}).waitFor({state:'hidden'});
 return {app,page};
}
(async()=>{
 let current;
 try{
  fs.mkdirSync(source);fs.mkdirSync(models);for(const ext of ['bin','param'])fs.writeFileSync(path.join(models,'test-4x.'+ext),'fixture');
  for(let i=0;i<12;i++)await sharp({create:{width:2,height:3,channels:3,background:'white'}}).png().toFile(path.join(source,i+'.png'));
  const settings={batchFolderPath:source,outputPath:folder,model:'test-4x',gpuId:'0',saveImageAs:'png',scale:'1',compression:'0',tileSize:32,ttaMode:false,useCustomWidth:false,customWidth:'',copyMetadata:false,noImageProcessing:false};
  const manager=new BatchManager(path.join(profile,'enhanced-sessions'),undefined,(_exe,args)=>spawn(process.execPath,[fake,...args]));
  let asked=false;manager.on('state',s=>{if(s.completed>=1&&!asked){asked=true;manager.pause();}});
  const ended=new Promise(r=>manager.once('settled',r));await manager.create(settings,models,fake);await ended;
  assert.equal(manager.session.phase,'paused');
  const journal=fs.readFileSync(manager.session.file),times=manager.session.items.filter(i=>i.state==='completed').map(i=>[i.name,fs.statSync(path.join(manager.session.output,i.name)).mtimeMs]);
  current=await open();assert.deepEqual(fs.readFileSync(manager.session.file),journal,'Cancel recovery must not mutate the journal');
  await current.app.close();current=undefined;
  current=await open();assert.deepEqual(fs.readFileSync(manager.session.file),journal,'Closing/reopening must retain paused state');
  await current.page.locator('input.toggle').first().click();
  await current.page.getByRole('button',{name:'Select Folder',exact:true}).click();
  await current.page.getByText('Current settings',{exact:true}).waitFor();
  await current.page.getByText('Previous settings',{exact:true}).waitFor();
  await current.page.getByRole('button',{name:'Resume Previous Session',exact:true}).click();
  await until(()=>current.app.evaluate(()=>global.recoveryPhase()==='completed'));
  await current.page.getByRole('button',{name:'Resume Previous Session',exact:true}).waitFor({state:'hidden'});
  for(const [name,time]of times)assert.equal(fs.statSync(path.join(manager.session.output,name)).mtimeMs,time);
  assert(!fs.existsSync(manager.session.file));
  console.log('Electron close/relaunch, recovery Cancel, selecting the same source folder and Resume passed; simulator backend, not a GPU test.');
 }finally{if(current)await current.app.close();fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
