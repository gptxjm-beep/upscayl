const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),sharp=require('sharp');
const {validateOutput,temporaryOutput,adoptOutput}=require('../../export/electron/jobs/output.js');
test('single output requires full decode, dimensions and atomic adoption without overwrite',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-output-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const final=path.join(root,'نتيجة image.png'),temp=temporaryOutput(final);
 await sharp({create:{width:8,height:12,channels:3,background:'red'}}).png().toFile(temp);
 await validateOutput(temp,8,12,'png');adoptOutput(temp,final);assert(!fs.existsSync(temp));
 const before=fs.readFileSync(final);const other=temporaryOutput(final);fs.writeFileSync(other,before);
 assert.throws(()=>adoptOutput(other,final),/EEXIST/);assert.deepEqual(fs.readFileSync(final),before);
 await assert.rejects(()=>validateOutput(other,16,24,'png'),/dimensions/);fs.writeFileSync(other,before.subarray(0,40));
 await assert.rejects(()=>validateOutput(other,8,12,'png'));assert.deepEqual(fs.readFileSync(final),before);
 assert.throws(()=>adoptOutput(final,other),/Unsafe/);
});
