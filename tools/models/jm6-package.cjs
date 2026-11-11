// Package only validated inference files and their notices. No original weights
// or validation input images are shipped. ZIP has one top-level models folder.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto'),{spawnSync}=require('child_process');
const {discoverModels}=require('../../export/electron/utils/model-discovery.js');
const root=path.resolve(__dirname,'../..'),dest=path.join(root,'.test-artifacts/jm6/model-package/models');
const hashes=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
(async()=>{assert(!fs.existsSync(dest),'Preserve existing package; choose a fresh build workspace.');fs.mkdirSync(dest,{recursive:true});
for(const source of process.argv.slice(2)){
 const scan=await discoverModels(path.resolve(source));assert.equal(scan.issues.length,0,JSON.stringify(scan.issues));assert(scan.models.length>0,'No verified models found');
 for(const id of scan.models){assert(!fs.existsSync(path.join(dest,id+'.model.json')),'Duplicate model identity: '+id);for(const name of fs.readdirSync(source)){if(name.startsWith(id+'.')&&fs.statSync(path.join(source,name)).isFile())fs.copyFileSync(path.join(source,name),path.join(dest,name));}}
}
const scan=await discoverModels(dest);assert.equal(scan.issues.length,0,JSON.stringify(scan.issues));assert(scan.models.length>=4);const report={models:scan.models,notIncluded:['4x-ultrasharp-v2-dat2','adaptivephotonet-6m'],reason:'Official weights/license unavailable in the current executor; these models are not supported or tested.',files:fs.readdirSync(dest).map(name=>({name,bytes:fs.statSync(path.join(dest,name)).size,sha256:hashes(path.join(dest,name))}))};fs.writeFileSync(path.join(path.dirname(dest),'model-package-manifest.json'),JSON.stringify(report,null,2));
fs.mkdirSync(path.join(root,'dist-enhanced'),{recursive:true});const zip=path.join(root,'dist-enhanced/Upscayl-Enhanced-jm6-Available-Models.zip');
const py='import pathlib,zipfile,sys\nb=pathlib.Path(sys.argv[1]);z=zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED,compresslevel=3)\nfor p in b.rglob("*"):\n if p.is_file():z.write(p,p.relative_to(b).as_posix())\nz.close()\nwith zipfile.ZipFile(sys.argv[2]) as z:\n assert z.testzip() is None\n assert all(n.startswith("models/") or n=="model-package-manifest.json" for n in z.namelist())\n';const r=spawnSync(process.env.PYTHON||'python',['-c',py,path.dirname(dest),zip],{stdio:'inherit'});assert.equal(r.status,0);
const row={name:path.basename(zip),size_bytes:fs.statSync(zip).size,sha256:hashes(zip)};fs.writeFileSync(path.join(root,'dist-enhanced/models-SHA256.txt'),row.sha256+'  '+row.name+'\n');fs.writeFileSync(path.join(root,'dist-enhanced/model-package-manifest.json'),JSON.stringify({...report,archive:row},null,2));console.log(JSON.stringify({...row,models:scan.models}));
})().catch(e=>{console.error(e);process.exitCode=1;});
