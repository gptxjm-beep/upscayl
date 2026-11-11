// Real renderer and IPC handlers. Shell open is observed instead of launching
// external viewers on the CI runner. No inference/performance claim.
const {_electron}=require('playwright-core'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-completion-'));
(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron'),args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:path.join(folder,'profile')}});
 try{
  const report=path.join(folder,'upscayl_batch_report.txt');fs.writeFileSync(report,'fixture report');
  const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');try{await page.getByRole('button',{name:'Close',exact:true}).click({timeout:5000});}catch{}
  await app.evaluate(({shell},{root,folder,report})=>{const req=process.getBuiltinModule('module').createRequire(root+'/package.json'),m=req(root+'/export/electron/jobs/integration.js').batchManager();m.session={id:'completion-fixture',source:'source',output:folder,settings:{model:'upscayl-standard-4x'},items:[],report,phase:'completed-with-errors'};global.opened=[];shell.openPath=async file=>{global.opened.push(file);return '';};},{root,folder,report});
  const send=phase=>app.evaluate(({BrowserWindow},{phase,folder,report})=>BrowserWindow.getAllWindows()[0].webContents.send('jm:state',{id:'completion-fixture',phase,kind:'batch',engineStopped:phase!=='running',completed:999,total:1000,failed:1,output:folder,report}),{phase,folder,report});
  await send('running');await page.getByText('Failed images: 1',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Completed with Errors',exact:true}).count(),0);await page.getByRole('button',{name:'STOP',exact:true}).waitFor();
  await send('paused');await page.getByRole('button',{name:'Resume',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Completed with Errors',exact:true}).count(),0);
  await send('completed-with-errors');await page.getByRole('heading',{name:'Completed with Errors',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'STOP',exact:true}).count(),0);
  for(const name of ['Open Error Report','Open Output Folder','Open Logs Folder'])await page.getByRole('button',{name,exact:true}).click();const opened=await app.evaluate(()=>global.opened);assert.equal(opened.length,3);assert.equal(opened[0],report);assert.equal(opened[1],folder);assert(opened[2].endsWith('logs'));
  const denied=await page.evaluate(async()=>window.electron.invoke('jm:report:open',{id:'another-job'}));assert.equal(denied.ok,false);assert.equal((await app.evaluate(()=>global.opened)).length,3);
  await page.screenshot({path:path.join(root,'.test-artifacts/jm5-completed-with-errors.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Close',exact:true}).last().click();await page.getByRole('heading',{name:'Completed with Errors',exact:true}).waitFor({state:'hidden'});
  await send('cancelled');assert.equal(await page.getByRole('heading',{name:'Completed with Errors',exact:true}).count(),0);
  // Avoid synthetic-journal persistence during the app's real shutdown hook.
  await app.evaluate((_e,root)=>process.getBuiltinModule('module').createRequire(root+'/package.json')(root+'/export/electron/jobs/integration.js').batchManager().session=undefined,root);
  console.log('Failed counter remains nonblocking; Completed with Errors has report/output/log actions. Pause/Cancel do not show completion; stale job ID cannot open a report. Synthetic states, real IPC authority.');
 }finally{try{await app.evaluate((_e,root)=>process.getBuiltinModule('module').createRequire(root+'/package.json')(root+'/export/electron/jobs/integration.js').batchManager().session=undefined,root);}catch{}await app.close();fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
