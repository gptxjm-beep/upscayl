// Exercise the actual ASAR library using Windows path semantics on any host.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');

test('ASAR payload verification normalizes nested paths for Windows',()=>{
 const filename=require.resolve('@electron/asar/lib/filesystem.js');
 const nativeRequire=createRequire(filename);
 const exports={};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
  exports,module:{exports},require:id=>id==='path'?path.win32:nativeRequire(id),
  __filename:filename,__dirname:path.dirname(filename),Buffer,console,process,
 });
 const archive=new exports.Filesystem('C:\\fixture');
 archive.setHeader({files:{export:{files:{electron:{files:{jobs:{files:{'integration.js':{size:7,offset:'0'}}}}}}}}});
 assert.throws(()=>archive.getFile('export/electron/jobs/integration.js'),/not found/);
 assert.equal(archive.getFile(path.win32.normalize('export/electron/jobs/integration.js')).size,7);
});
