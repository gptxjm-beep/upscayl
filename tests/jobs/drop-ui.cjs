// Real native-backed File -> preload webUtils -> main validation -> image preview.
// Windows CI runs this against the packaged application, without a validation mock.
const {_electron}=require('playwright-core');
const fs=require('fs'),os=require('os'),path=require('path'),sharp=require('sharp'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-drop-ui-'));
const packaged=process.env.UPSCAYL_TEST_APP_EXE,shots=path.join(root,'.test-artifacts');fs.mkdirSync(shots,{recursive:true});
(async()=>{
 const deep=path.join(folder,'مجلد عربي',...Array.from({length:5},(_,i)=>'chapter-'+i));fs.mkdirSync(deep,{recursive:true});
 const files=[];for(const format of ['jpg','png','webp']){const file=path.join(deep,'صورة %20 with spaces.'+format);await sharp({create:{width:17,height:11,channels:3,background:'#1b35a7'}}).toFile(file);files.push(file);}
 const bad=path.join(folder,'not-image.txt');fs.writeFileSync(bad,'not an image');
 const app=await _electron.launch({executablePath:packaged||path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron'),args:[...(packaged?[]:[root]),...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:path.join(folder,'profile')}});
 try{
  if(process.platform==='linux'){
   await app.evaluate(({ipcMain},{root,node})=>{
    const req=process.getBuiltinModule('module').createRequire(root+'/package.json');ipcMain.removeHandler('Validate input image');
    ipcMain.handle('Validate input image',(_event,file)=>new Promise((resolve,reject)=>req('child_process').execFile(node,['-e','require(process.argv[1]).inspectImage(process.argv[2]).then(r=>process.stdout.write(JSON.stringify(r)))',root+'/export/electron/jobs/open-image.js',file],{env:{...process.env,NODE_OPTIONS:''}},(error,out)=>error?reject(error):resolve(JSON.parse(out)))));
   },{root,node:process.execPath});
   console.log('Linux-only validation executes the same inspectImage function in external Node due to the documented Electron/libvips ABI assertion. Windows packaged test uses the real main IPC handler.');
  }
  const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');try{await page.getByRole('button',{name:'Close',exact:true}).click({timeout:5000});}catch{}
  const original=page.url(),zone=page.locator('[data-upscayl-drop-zone]'),preview=zone.locator('img[draggable="false"]');
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='native-file-fixture';input.hidden=true;document.body.appendChild(input);});
  async function drop(file,target=zone,emptyMime=false){
   await page.locator('#native-file-fixture').setInputFiles(file);
   const evidence=await page.evaluate(()=>{const file=document.querySelector('#native-file-fixture').files[0];return {legacyPath:file.path,path:window.electron.getPathForFile(file)};});
   assert.equal(evidence.legacyPath,undefined,'Electron 33 has no File.path');assert.equal(fs.realpathSync(evidence.path),fs.realpathSync(file),'Official bridge preserves native file identity');
   const data=await page.evaluateHandle(empty=>{const dt=new DataTransfer();dt.items.add(document.querySelector('#native-file-fixture').files[0]);if(empty)Object.defineProperty(dt.files[0],'type',{value:''});return dt;},emptyMime);
   await target.dispatchEvent('drop',{dataTransfer:data});await data.dispose();
  }
  for(const file of files){await drop(file,zone,true);await page.waitForFunction(ext=>{const im=document.querySelector('[data-upscayl-drop-zone] img[draggable="false"]');return im?.complete&&im.naturalWidth===17&&im.naturalHeight===11&&im.src.endsWith(ext);},path.extname(file));assert.equal(page.url(),original);}
  let before=await preview.getAttribute('src');await drop(bad);await page.getByText('The image could not be opened.',{exact:false}).first().waitFor();assert.equal(await preview.getAttribute('src'),before);
  await drop(files[0],page.locator('.tabs').first());await page.getByText('Drop the image inside the preview area.',{exact:true}).waitFor();assert.equal(await preview.getAttribute('src'),before);
  const link=await page.evaluateHandle(()=>{const dt=new DataTransfer();dt.setData('text/uri-list','https://example.com/not-an-image');return dt;});await zone.dispatchEvent('drop',{dataTransfer:link});await link.dispose();assert.equal(page.url(),original);assert.equal(await preview.getAttribute('src'),before);
  await drop(files[1]);await page.waitForFunction(()=>document.querySelector('[data-upscayl-drop-zone] img[draggable="false"]')?.src.includes('.png'));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},files[2]);await page.getByRole('button',{name:'Select Image',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-upscayl-drop-zone] img[draggable="false"]')?.src.includes('.webp'));
  if(process.env.UPSCAYL_TEST_LONG_PNG){await drop(path.resolve(process.env.UPSCAYL_TEST_LONG_PNG));await page.waitForFunction(()=>document.querySelector('[data-upscayl-drop-zone] img[draggable="false"]')?.naturalHeight===70200,{},{timeout:60000});console.log((packaged?'Packaged':'Development')+' Electron preview opened the controlled 1440x70200 PNG. External Windows viewers remain separate tests.');}
  await page.evaluate(()=>location.assign('file:///outside-the-application.txt'));await page.waitForTimeout(200);assert.equal(page.url(),original,'Main navigation guard blocks renderer navigation outside the app');
  await page.screenshot({path:path.join(shots,'jm5-drop-preview.png'),animations:'disabled'});
  console.log('JPG/PNG/WEBP, empty MIME, Arabic/spaces/%20/deep paths, invalid input preservation, outside drops, links, retry, Select Image and navigation guard passed; packaged='+!!packaged);
 }finally{await app.close();fs.rmSync(folder,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
