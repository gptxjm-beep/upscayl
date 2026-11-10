// Real Electron controls/payloads; inference itself is covered by the native test.
const {_electron}=require('playwright-core'),fs=require('fs'),os=require('os'),path=require('path'),sharp=require('sharp'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-two-ui-'));
(async()=>{
 const image=path.join(folder,'صورة.png');await sharp({create:{width:32,height:32,channels:3,background:'gray'}}).png().toFile(image);
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron'),args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:path.join(folder,'profile')}});
 try{
  await app.evaluate(({ipcMain,dialog},{root,node,image})=>{
   const req=process.getBuiltinModule('module').createRequire(root+'/package.json'),C=req(root+'/export/common/electron-commands.js').ELECTRON_COMMANDS;global.payloads=[];
   for(const channel of [C.FOLDER_UPSCAYL,C.UPSCAYL]){ipcMain.removeAllListeners(channel);ipcMain.on(channel,(_event,payload)=>global.payloads.push({channel,payload}));}
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[image]});
   if(process.platform==='linux'){ipcMain.removeHandler(C.VALIDATE_INPUT_IMAGE);ipcMain.handle(C.VALIDATE_INPUT_IMAGE,(_e,file)=>new Promise((resolve,reject)=>req('child_process').execFile(node,['-e','require(process.argv[1]).inspectImage(process.argv[2]).then(r=>process.stdout.write(JSON.stringify(r)))',root+'/export/electron/jobs/open-image.js',file],{env:{...process.env,NODE_OPTIONS:''}},(error,out)=>error?reject(error):resolve(JSON.parse(out)))));}
  },{root,node:process.execPath,image});
  const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');try{await page.getByRole('button',{name:'Close',exact:true}).click({timeout:5000});}catch{}
  const toggle=page.getByRole('checkbox',{name:'Use Two AI Models',exact:true}),second=page.getByRole('button',{name:'Select Second AI Model',exact:true});
  assert.equal(await toggle.isChecked(),false);assert.equal(await second.isDisabled(),true);assert.equal(await second.isVisible(),true);
  await toggle.check();assert.equal(await second.isDisabled(),false);
  const classic=page.getByText('Double Upscayl',{exact:true}).locator('..').locator('input');assert.equal(await classic.isDisabled(),true);assert.equal(await classic.isChecked(),false);
  await second.click();await page.locator('[role="dialog"][data-state="open"]').getByText('High Fidelity',{exact:true}).click();assert.match(await second.innerText(),/High Fidelity/);
  await page.getByRole('button',{name:'Select Image',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-upscayl-drop-zone] img[draggable="false"]')?.naturalWidth===32);
  await page.screenshot({path:path.join(root,'.test-artifacts/jm5-two-stage-controls.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Upscayl 🚀',exact:true}).click();await page.waitForTimeout(100);
  let payloads=await app.evaluate(()=>global.payloads);assert.equal(payloads.length,1);assert.equal(payloads[0].payload.useTwoModels,true);assert.equal(payloads[0].payload.secondModel,'high-fidelity-4x');assert.equal(payloads[0].payload.singleImage,image);assert.equal(payloads[0].channel,require('../../export/common/electron-commands.js').ELECTRON_COMMANDS.FOLDER_UPSCAYL);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('jm:state',null));
  await toggle.uncheck();assert.equal(await second.isDisabled(),true);assert.match(await second.innerText(),/High Fidelity/);
  await page.getByRole('button',{name:'Upscayl 🚀',exact:true}).click();await page.waitForTimeout(100);payloads=await app.evaluate(()=>global.payloads);assert.equal(payloads.length,2);assert.equal(payloads[1].payload.useTwoModels,undefined);assert.equal(payloads[1].payload.secondModel,undefined);assert.equal(payloads[1].payload.singleImage,undefined);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('jm:state',{id:'single-fixture',kind:'single',phase:'paused',engineStopped:true,completed:0,total:1,settings:{singleImage:'fixture.png'}}));
  await page.getByRole('button',{name:'Resume',exact:true}).waitFor();await page.getByRole('button',{name:'STOP',exact:true}).waitFor();
  console.log('Two-stage opt-in/default-off, disabled visible second picker, order/Single payload, legacy payload isolation, Classic Double exclusion and managed-Single center controls passed. Synthetic IPC only; no inference claim.');
 }finally{await app.close();fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
