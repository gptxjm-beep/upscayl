const {test}=require('node:test'),assert=require('node:assert/strict');
const {fdatSessionOptions,runtimeErrorCode}=require('../../export/electron/jobs/onnx-worker.js');
const {describeFailure}=require('../../export/electron/jobs/failure.js');
const corrected={id:'fdat',manifest:{graphVersion:'fdat-dml17-v1',spatialSymbols:['s53','s0']}},options={provider:'dml',gpuId:'0'};
test('FDAT DirectML binds correct height/width symbols; sequential and memory settings remain required',()=>{
 const config=fdatSessionOptions(corrected,options,112,72);
 assert.deepEqual(config.freeDimensionOverrides,{s53:72,s0:112});assert.equal(config.executionMode,'sequential');assert.equal(config.enableMemPattern,false);assert.deepEqual(config.executionProviders,[{name:'dml',deviceId:0}]);
});
test('CPU, working models and explicit diagnostic dynamic control retain original session configuration',()=>{
 const expected={executionProviders:[{name:'dml',deviceId:0}],executionMode:'sequential',enableMemPattern:false,intraOpNumThreads:2,interOpNumThreads:1};
 assert.deepEqual(fdatSessionOptions({id:'alchemy',manifest:{}},options,160,160),expected);
 assert.deepEqual(fdatSessionOptions({id:'lut',manifest:{}},options,256,256),expected);
 assert.deepEqual(fdatSessionOptions(corrected,{...options,fdatShapeMode:'dynamic'},160,160),expected);
 assert.deepEqual(fdatSessionOptions(corrected,{provider:'cpu',gpuId:'0'},160,160),{...expected,executionProviders:['cpu']});
 assert.throws(()=>fdatSessionOptions({manifest:{graphVersion:'fdat-dml17-v1'}},options,160,160),/metadata/);
});
test('original DirectML HRESULT is retained and generic exception is not described as memory exhaustion',()=>{
 for(const text of ['Error: DmlExecutionProvider Exception(2) 8007023E','MemcpyFromHost 0x8007023e']){
  assert.equal(runtimeErrorCode(text),'0x8007023E');const f=describeFailure(text,'page.png','stageone','-2147024322');assert.equal(f.code,'0x8007023E');assert.match(f.reason,/does not establish a memory shortage/);
 }
 assert.equal(runtimeErrorCode('hash abcdef1234567890'),undefined);
 assert.equal(runtimeErrorCode('No implementation for node 2787'),undefined);
 const memory=describeFailure('out of memory','page.png','inference');assert.match(memory.reason,/not enough memory/);
});
