// Real settings/discovery/persistence and controls. Intercept only launch IPC;
// actual inference is verified separately against original trained weights.
const {_electron}=require('playwright-core'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm6-model-ui-')),models=path.resolve(process.env.JM6_MODELS_DIR||'.test-artifacts/jm6/models');
const exe=path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron');
async function launch(){const app=await _electron.launch({executablePath:exe,args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,ELECTRON_IS_DEV:'0',UPSCAYL_TEST_USER_DATA:path.join(folder,'profile')}});const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');try{await page.getByRole('button',{name:'Close',exact:true}).click({timeout:4000});}catch{}return {app,page};}
(async()=>{let {app,page}=await launch();try{
 await app.evaluate(({dialog},models)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[models]});dialog.showMessageBoxSync=()=>0;},models);
 await page.locator('.tabs .tab').filter({hasText:'Settings'}).click();await page.locator('[data-model-folder-select]').click();await page.getByText(models,{exact:true}).waitFor();
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});await page.locator('[data-model-folder-select]').click();assert.equal(await page.getByText(models,{exact:true}).count(),1);
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.locator('[data-model-folder-select]').click();assert.equal(await page.getByText(models,{exact:true}).count(),1);
 await page.locator('.tabs .tab').filter({hasText:'Upscayl'}).click();await page.getByRole('button',{name:'First AI Model',exact:true}).click();const dialog=page.locator('[role="dialog"][data-state="open"]');
 await dialog.getByText('Adaptive 3D LUT — 1X',{exact:true}).click();await page.getByLabel('Color style',{exact:true}).selectOption('vivid');assert.equal(await page.getByLabel('Color strength',{exact:true}).inputValue(),'65');assert.match(await page.getByText(/Image Scale/).first().innerText(),/1x/i);
 const button=page.getByRole('button',{name:'First AI Model',exact:true});assert.equal(Math.round((await button.boundingBox()).height),48);assert.match(await button.locator('[title]').getAttribute('title'),/Image-Adaptive 3D LUT/);
 await button.click();for(const name of ['UltraSharp V2 — 4X','AdaptivePhotoNet — 1X'])assert.equal(await page.locator('[role="dialog"][data-state="open"]').getByText(name,{exact:true}).count(),0);
 await page.keyboard.press('Escape');await page.screenshot({path:path.join(root,'.test-artifacts/jm6/model-controls.png')});
}finally{await app.close();}
 ({app,page}=await launch());try{await page.locator('.tabs .tab').filter({hasText:'Settings'}).click();await page.getByText(models,{exact:true}).waitFor();await page.locator('.tabs .tab').filter({hasText:'Upscayl'}).click();await page.getByRole('button',{name:'First AI Model',exact:true}).click();await page.locator('[role="dialog"][data-state="open"]').getByText('Alchemy 4X — 4X',{exact:true}).waitFor();console.log('Verified model folder import, invalid/cancel preservation, restart persistence, color default 1X, actual settings controls and fixed picker height passed. UI only; actual inference has separate tests.');}finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
