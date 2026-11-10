const {_electron}=require('playwright-core');
const path=require('path'),fs=require('fs'),os=require('os');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'upscayl-ui-jm4-'));
const screenshots=path.join(root,'.test-artifacts');fs.mkdirSync(screenshots,{recursive:true});
(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron'),args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:profile}});
 try {
 const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
 const close=page.getByRole('button',{name:'Close',exact:true});try{await close.waitFor({timeout:5000});await close.click();}catch{}
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 UpscaylEnhanced/2.15.0-jm.3 Electron/33.2.1'});
 // Reproduce the packaged Enhanced user agent which crashed jm.1 Settings.
 for(let n=0;n<3;n++) {
  await page.locator('.tabs .tab').filter({hasText:'Settings'}).click();
  await page.getByText('SAVE IMAGE AS',{exact:true}).waitFor();
  assert.equal(await page.getByText('An error occurred in the app.').count(),0);
  if(n===0){await page.getByRole('button',{name:'JPG',exact:true}).click();await page.getByRole('button',{name:'PNG',exact:true}).click();}
  await page.locator('.tabs .tab').filter({hasText:'Upscayl'}).click();
 }
 assert.equal(await page.getByRole('button',{name:/Pause|Resume/i}).count(),0,'Idle Step 4 must remain original');
 // Exercise the actual custom STOP broker and main handler. No OS dialog.
 await app.evaluate(async (_electron,root)=>{
  const req=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const assert=req('node:assert/strict'),integration=req(root+'/export/electron/jobs/integration.js');
  const manager=integration.batchManager(),stop=req(root+'/export/electron/commands/stop.js').default;
  const snapshot=manager.snapshot,cancel=manager.cancel,active=manager.hasActiveBatch;
  try{
   let cancelled=0;manager.session={id:'stop-fixture',phase:'paused'};
   manager.snapshot=()=>({id:'stop-fixture',phase:'paused',completed:2,total:6});manager.hasActiveBatch=()=>true;
   manager.cancel=async()=>{cancelled++;};
   for(const choice of ['dismiss','stop']){
    const action=stop(null,{batch:true,batchSessionId:'stop-fixture'});
    assert.equal(integration.batchPrompts.current.kind,'stop');
    await integration.batchPrompts.act(integration.batchPrompts.current.token,choice);await action;
   }
   assert.equal(cancelled,1);await stop(null,null);assert.equal(integration.batchPrompts.current,null);
  }finally{manager.snapshot=snapshot;manager.cancel=cancel;manager.hasActiveBatch=active;manager.session=undefined;}
 },root);
 const send=phase=>app.evaluate(({BrowserWindow},phase)=>BrowserWindow.getAllWindows()[0].webContents.send('jm:state',{id:'ui-fixture',phase,engineStopped:phase==='paused',completed:phase==='paused'?4:3,total:12}),phase);
 for(const phase of ['running','pausing','paused','running']) {
  await send(phase);
  const label=phase==='paused'?'Resume':phase==='pausing'?'Pausing...':'Pause';
  const button=page.getByRole('button',{name:label,exact:true});await button.waitFor();
  const stop=page.getByRole('button',{name:'STOP',exact:true});await stop.waitFor();
  assert.equal(await button.isDisabled(),phase==='pausing');assert.equal(await stop.isDisabled(),false);
  assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).count(),0);
  if(phase==='paused'||phase==='running') {
    const channel=phase==='paused'?'jm:resume':'jm:pause';
    await app.evaluate(({ipcMain},channel)=>{
      global.uiCommandReceived=false;ipcMain.removeHandler(channel);
      ipcMain.handle(channel,async()=>{global.uiCommandReceived=true;await new Promise(r=>setTimeout(r,500));return {ok:true};});
    },channel);
    await button.click();
    const pending=page.getByRole('button',{name:phase==='paused'?'Resuming...':'Pausing...',exact:true});
    await pending.waitFor();assert.equal(await pending.isDisabled(),true,'Immediate pending feedback');
    assert.equal(await app.evaluate(()=>global.uiCommandReceived),true);
    await button.waitFor();

  }
  const card=button.locator('..').locator('..');
  assert.equal(await card.getByRole('button',{name:'STOP',exact:true}).count(),1);
  const a=await stop.boundingBox(),b=await button.boundingBox();assert(Math.abs(a.y-b.y)<2&&Math.abs(a.height-b.height)<2);
  if(phase==='paused')await page.getByText('Processing engine stopped. Engine GPU resources released. Progress saved.',{exact:false}).waitFor();
  await page.screenshot({animations:'disabled',path:path.join(screenshots,`jm4-${phase}.png`)});
 }
 await send('paused');await page.setViewportSize({width:650,height:750});
 await page.getByRole('button',{name:'Resume',exact:true}).waitFor();
 await page.screenshot({animations:'disabled',path:path.join(screenshots,'jm4-paused-small.png')});
 await send('completed');await page.getByRole('button',{name:'Resume',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0);
 // Cancellation before the first durable session must clear the initial card.
 await app.evaluate(({ipcMain,dialog})=>{
  ipcMain.removeAllListeners('Upscale a Folder');ipcMain.on('Upscale a Folder',()=>{});
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.platform==='win32'?'C:/fixture':'/tmp/fixture']});
 });
 await page.getByRole('button',{name:'Select Folder',exact:true}).click();
 await page.getByRole('button',{name:'Upscayl 🚀',exact:true}).click();
 await page.getByRole('button',{name:'STOP',exact:true}).waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('jm:state',null));
 await page.getByRole('button',{name:'STOP',exact:true}).waitFor({state:'hidden'});
 console.log('Settings navigation/editing, original Step 4, original center card, early preparation cancellation and STOP/PAUSE/RESUME states passed; synthetic job states, no GPU claim.');
 }catch(error){
   const page=await app.firstWindow();
   console.error('UI body at failure:',await page.locator('body').innerText());
   await page.screenshot({animations:'disabled',path:path.join(screenshots,'jm4-ui-failure.png')}).catch(()=>{});
   throw error;
 }finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
