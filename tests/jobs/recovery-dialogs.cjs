// Real renderer/main prompt broker, synthetic jobs. No GPU or disk recovery claim.
const {_electron}=require('playwright-core');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'jm4-dialogs-'));
const shots=path.join(root,'.test-artifacts');fs.mkdirSync(shots,{recursive:true});
(async()=>{
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron'),args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:profile}});
 try{
  const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  try{await page.getByRole('button',{name:'Close',exact:true}).click({timeout:5000});}catch{}
  const open=kind=>app.evaluate((_e,{root,kind})=>{
   const req=process.getBuiltinModule('module').createRequire(root+'/package.json'),broker=req(root+'/export/electron/jobs/integration.js').batchPrompts;
   const settings={model:'upscayl-standard-4x',scale:'2',saveImageAs:'png'};
   global.dialogChoices=[];void broker.open({kind,session:{id:'fixture',source:'C:/Manga/Chapter 55',output:'C:/Results/Chapter 55',completed:55,total:100,phase:'running',settings},currentSettings:{...settings,model:'high-fidelity-4x',scale:'4'}},async choice=>{global.dialogChoices.push(choice);if(choice!=='dismiss')await new Promise((resolve,reject)=>{global.finishDialog=resolve;global.failDialog=()=>reject(Error('Fixture recovery failed; saved progress kept.'));});});
  },{root,kind});
  const finish=()=>app.evaluate(()=>global.finishDialog());
  await open('startup');await page.locator('[role="dialog"][data-state="open"]').waitFor();
  await page.getByRole('button',{name:'Not Now',exact:true}).click();await page.locator('[role="dialog"][data-state="open"]').waitFor({state:'hidden'});
  assert.deepEqual(await app.evaluate(()=>global.dialogChoices),['dismiss']);
  await open('folder');await page.getByText('Current settings',{exact:true}).waitFor();await page.getByText('Previous settings',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:path.join(shots,'jm4-folder-recovery.png')});
  await page.getByRole('button',{name:'Start Fresh with Current Settings',exact:false}).click();
  await page.getByRole('status').waitFor();assert.equal(await page.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('[role="dialog"][data-state="open"]').count(),1,'Must remain visible while preparing');
  assert.deepEqual(await app.evaluate(()=>global.dialogChoices),['fresh']);await finish();await page.locator('[role="dialog"][data-state="open"]').waitFor({state:'hidden'});
  await open('startup');await page.getByRole('button',{name:'Resume Processing',exact:true}).click();
  await page.getByRole('status').waitFor();assert.equal(await page.getByRole('button',{name:'Not Now',exact:true}).isDisabled(),true);
  await page.screenshot({animations:'disabled',path:path.join(shots,'jm4-recovery-pending.png')});
  await app.evaluate(()=>global.failDialog());await page.getByRole('alert').filter({hasText:'Fixture recovery failed'}).waitFor();assert.equal(await page.getByRole('button',{name:'Resume Processing',exact:true}).isDisabled(),false);
  await page.getByRole('button',{name:'Resume Processing',exact:true}).click();await page.getByRole('status').waitFor();await finish();await page.locator('[role="dialog"][data-state="open"]').waitFor({state:'hidden'});
  await open('stop');await page.getByRole('button',{name:'Go Back',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Go Back',exact:true}).evaluate(e=>e===document.activeElement),true);
  await page.screenshot({animations:'disabled',path:path.join(shots,'jm4-stop-confirmation.png')});await page.getByRole('button',{name:'Go Back',exact:true}).click();
  await page.locator('[role="dialog"][data-state="open"]').waitFor({state:'hidden'});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('jm:state',{id:'error',phase:'failed',completed:55,total:100,engineStopped:true,lastError:'Image 000053.jpg failed during encode',failure:{image:'000053.jpg',reason:'The image encoder rejected invalid or unsupported output dimensions.',details:'WIC PNG input=720x29700 inferred=2880x118800 final=1440x59400 HRESULT=0x88982f51'}}));
  await page.getByText('000053.jpg',{exact:true}).waitFor();assert.equal(await page.locator('details').getAttribute('open'),null);
  await page.screenshot({animations:'disabled',path:path.join(shots,'jm4-error-compact.png')});await page.getByText('Technical details',{exact:true}).click();await page.getByText(/WIC PNG input=/).waitFor();
  await page.setViewportSize({width:650,height:750});await open('folder');await page.locator('[role="dialog"][data-state="open"]').waitFor();await page.screenshot({animations:'disabled',path:path.join(shots,'jm4-recovery-small.png')});
  const box=await page.locator('[role="dialog"][data-state="open"]').boundingBox();assert(box.x>=0&&box.x+box.width<=650);await page.getByRole('button',{name:'Cancel',exact:true}).click();
  console.log('Custom startup/folder/STOP dialogs, immediate pending feedback, retry, settings comparison, compact error details and narrow viewport passed. Synthetic states; no GPU claim.');
 }finally{await app.close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
