const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {OPTIONAL_MODELS}=require('../../export/common/model-metadata.js');
const getScale=require('../../export/common/check-model-scale.js').default;
const {getSingleImageArguments}=require('../../export/electron/utils/get-arguments.js');
const {verifiedOptionalModel}=require('../../export/electron/jobs/model-files.js');
const {hash}=require('../../export/electron/jobs/store.js');
test('authoritative 1X/2X/4X metadata reaches CLI independently of final scale',()=>{
 for(const [id,m] of Object.entries(OPTIONAL_MODELS)){
  assert.equal(getScale(id),String(m.nativeScale));
  const args=getSingleImageArguments({inputDir:'input',fileNameWithExt:'page.png',outFile:'output.png',modelsPath:'custom',model:id,scale:'1',gpuId:'0',saveImageAs:'png',customWidth:'',tileSize:32,compression:'0',ttaMode:false});
  assert.equal(args[args.indexOf('-z')+1],String(m.nativeScale));
  if(m.fullPrecision)assert.equal(args[args.indexOf('-F')+1],'1');
  if(m.inputMultiple>1)assert.equal(args[args.indexOf('-a')+1],String(m.inputMultiple));
 }
 assert.equal(getScale('model-x16'),'16');assert.equal(getScale('foo-2x'),'2');assert.equal(getScale('unknown'),'4');
});
test('curated imports stay unavailable without a passed, acknowledged, hash-matched manifest',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jm-model-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const id='2x-mangajanai-1600p-v1-esrgan',m=OPTIONAL_MODELS[id],file=path.join(dir,id+'.model.json');
 await assert.rejects(()=>verifiedOptionalModel(dir,id),/import and verify/);
 for(const ext of ['param','bin'])fs.writeFileSync(path.join(dir,id+'.'+ext),'fixture');
 const data={version:1,id,...m,licenseAccepted:true,validation:{passed:true,pipeline:'jm5-model-api-v1'},files:{param:await hash(path.join(dir,id+'.param')),bin:await hash(path.join(dir,id+'.bin'))}};
 fs.writeFileSync(file,JSON.stringify(data));assert.equal(await verifiedOptionalModel(dir,id),data.files.param+':'+data.files.bin);
 data.licenseAccepted=false;fs.writeFileSync(file,JSON.stringify(data));await assert.rejects(()=>verifiedOptionalModel(dir,id),/license-acknowledged/);
 data.licenseAccepted=true;fs.writeFileSync(file,JSON.stringify(data));fs.appendFileSync(path.join(dir,id+'.bin'),'changed');await assert.rejects(()=>verifiedOptionalModel(dir,id),/changed after validation/);
 assert.equal(await verifiedOptionalModel(dir,'legacy-custom-4x'),undefined);
});
