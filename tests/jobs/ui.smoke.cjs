const {_electron}=require('playwright-core');
const path=require('path'),fs=require('fs'),os=require('os');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'upscayl-ui-jm3-'));
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
 // Exercise the real STOP handler's native-dialog decisions; disk/process
 // cancellation is tested independently against BatchManager and NCNN.
 await app.evaluate(async ({dialog},root)=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const path=require('path'),assert=require('node:assert/strict');
  const integration=require(path.join(root,'export/electron/jobs/integration.js'));
  const stop=require(path.join(root,'export/electron/commands/stop.js')).default;
  const get=integration.batchManager,show=dialog.showMessageBox;
  try {
   for(const phase of ['running','pausing','paused'])for(const response of [0,1]) {
    let cancelled=0;const manager={session:{id:'stop-fixture',phase},cancel:async()=>{cancelled++;}};
    integration.batchManager=()=>manager;
    dialog.showMessageBox=async (...args)=>{const options=args[args.length-1];assert.equal(options.title,'Cancel Batch Processing?');assert.deepEqual(options.buttons,['Go Back','Yes, Cancel Batch']);assert.equal(options.defaultId,0);return {response};};
    await stop(null,{batchSessionId:'stop-fixture'});assert.equal(cancelled,response);assert.equal(manager.session.phase,phase);
   }
   let dialogs=0;integration.batchManager=()=>({session:{id:'paused-batch',phase:'paused'}});
   dialog.showMessageBox=async()=>{dialogs++;return {response:0};};
   await stop(null,null);assert.equal(dialogs,0,'Original Single/Double STOP must not gain batch confirmation');
  }finally{integration.batchManager=get;dialog.showMessageBox=show;}
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
    await app.evaluate(({ipcMain},channel)=>{global.uiCommandReceived=false;ipcMain.once(channel,()=>{global.uiCommandReceived=true;});},channel);
    await button.click();
    assert.equal(await app.evaluate(()=>global.uiCommandReceived),true,'Progress-card button must send its actual IPC command');
  }
  const card=button.locator('..').locator('..');
  assert.equal(await card.getByRole('button',{name:'STOP',exact:true}).count(),1);
  const a=await stop.boundingBox(),b=await button.boundingBox();assert(Math.abs(a.y-b.y)<2&&Math.abs(a.height-b.height)<2);
  if(phase==='paused')await page.getByText('Processing engine stopped. Engine GPU resources released. Progress saved.',{exact:false}).waitFor();
  await page.screenshot({path:path.join(screenshots,`jm3-${phase}.png`)});
 }
 await send('paused');await page.setViewportSize({width:650,height:750});
 await page.getByRole('button',{name:'Resume',exact:true}).waitFor();
 await page.screenshot({path:path.join(screenshots,'jm3-paused-small.png')});
 await send('completed');await page.getByRole('button',{name:'Resume',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0);
 console.log('Settings navigation/editing, original Step 4, original center card and STOP/PAUSE/RESUME states passed; synthetic job states, no GPU claim.');
 }catch(error){
   const page=await app.firstWindow();
   console.error('UI body at failure:',await page.locator('body').innerText());
   await page.screenshot({path:path.join(screenshots,'jm3-ui-failure.png')}).catch(()=>{});
   throw error;
 }finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
