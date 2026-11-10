const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),sharp=require('sharp');
const {inspectImage}=require('../../export/electron/jobs/open-image.js'),decodePath=require('../../export/common/decode-path.js').default;
const {pathToFileURL}=require('url');
test('File-backed input accepts JPG/PNG/WEBP, Arabic/spaces/deep paths and validates full contents',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-drop-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const deep=path.join(root,...Array.from({length:6},(_,i)=>'chapter-'+i));fs.mkdirSync(deep,{recursive:true});
 for(const format of ['jpg','png','webp']){
  const file=path.join(deep,'صورة %20 with spaces.'+format);await sharp({create:{width:17,height:11,channels:3,background:'#1b35a7'}}).toFile(file);
  const result=await inspectImage(file);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.width,17);assert.equal(result.height,11);assert.equal(result.path,fs.realpathSync.native(file));
  assert.equal(decodePath(file),path.normalize(file));assert.equal(decodePath(pathToFileURL(file).href),path.normalize(file));
 }
});
test('Input rejects URLs, missing/partial/disguised files and directories without changing any originals',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-drop-invalid-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const text=path.join(root,'bad.txt'),fake=path.join(root,'fake.png'),partial=path.join(root,'partial.png');fs.writeFileSync(text,'original');fs.writeFileSync(fake,'not an image');
 const valid=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();fs.writeFileSync(partial,valid.subarray(0,40));
 for(const value of ['','relative.png','https://example.com/image.png','file:///tmp/image.png',text,fake,partial,path.join(root,'absent.jpg')])assert.equal((await inspectImage(value)).ok,false,JSON.stringify(value));
 const dir=path.join(root,'folder.png');fs.mkdirSync(dir);assert.equal((await inspectImage(dir)).ok,false);assert.equal(fs.readFileSync(text,'utf8'),'original');
});
