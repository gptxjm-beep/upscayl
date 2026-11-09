const {_electron}=require('playwright-core');
const path=require('path'),fs=require('fs'),os=require('os');
const root=path.resolve(__dirname,'../..');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'upscayl-ui-'));
const screenshots=path.join(root,'.test-artifacts');fs.mkdirSync(screenshots,{recursive:true});
(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron'),args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:profile}});
 try {
 const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
 const close=page.getByRole('button',{name:'Close',exact:true});try { await close.waitFor({timeout:5000}); await close.click(); } catch {}
 for(const phase of ['running','pausing','paused','completed']) {
  await app.evaluate(({BrowserWindow},phase)=> BrowserWindow.getAllWindows()[0].webContents.send('jm:state',{id:'ui-fixture',phase,completed:3,total:12}),phase);
  const name=phase==='paused'?'Resume ▶':phase==='pausing'?'Pausing...':'Pause ⏸';
  const button=page.getByRole('button',{name,exact:true});await button.waitFor();
  const disabled=phase==='pausing'||phase==='completed';
  if(await button.isDisabled()!==disabled)throw Error('Wrong disabled state: '+phase);
  if(phase==='paused')await page.getByText('Progress saved. Ready to resume.',{exact:false}).waitFor();
 }
 await page.setViewportSize({width:650,height:750});
 const pause=page.getByRole('button',{name:'Pause ⏸',exact:true});await pause.scrollIntoViewIfNeeded();
 const start=page.getByRole('button',{name:'Upscayl 🚀',exact:true});const a=await start.boundingBox(),b=await pause.boundingBox();
 if(Math.abs(a.y-b.y)>2||Math.abs(a.height-b.height)>2||a.x+a.width>b.x)throw Error('Small viewport layout mismatch');
 await page.screenshot({path:path.join(screenshots,'enhanced-ui-small-step4.png')});
 console.log('Electron UI state and small-screen layout checks passed (synthetic state events, no GPU).');
 }finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
