// Real original trained models: combined worker must match two ordered native
// invocations with exactly one final resize. Functional software Vulkan only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp'),{spawn}=require('node:child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const root=path.resolve(__dirname,'../..'),models=process.env.JM5_VERIFIED_MODEL_DIR,engine=process.env.UPSCAYL_TEST_ENGINE;
if(!models||!engine)throw Error('Explicit verified model directory and engine required; no silent skip.');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'jm5-trained-pair-'));
async function run(args,name){const log=fs.openSync(path.join(folder,name+'.log'),'w');try{const p=spawn(engine,args,{windowsHide:true,stdio:['ignore',log,log]});assert.equal(await new Promise((resolve,reject)=>{p.once('error',reject);p.once('exit',resolve);}),0);}finally{fs.closeSync(log);}}
(async()=>{
 const source=path.join(folder,'source');fs.mkdirSync(source);const image=path.join(source,'page.png'),raw=Buffer.alloc(8*8*3);for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=(y*8+x)*3;raw[i]=(x*7+y*3)%256;raw[i+1]=(x*2+y*11)%256;raw[i+2]=(x*13+y*5)%256;}await sharp(raw,{raw:{width:8,height:8,channels:3}}).png().toFile(image);
 const first=process.env.JM5_FIRST_MODEL||'2x-mangajanai-1600p-v1-esrgan',second='4x-illustrationjanai-v1-esrgan';
 const meta=require('../../export/common/model-metadata.js').modelMetadata(first);
 const m=new BatchManager(path.join(folder,'registry'));m.on('problem',e=>console.error(String(e)));const completed=new Promise(resolve=>m.once('settled',resolve));
 await m.create({batchFolderPath:source,outputPath:folder,model:first,useTwoModels:true,secondModel:second,gpuId:'0',saveImageAs:'png',scale:'2',compression:'0',tileSize:32,ttaMode:false,useCustomWidth:false,customWidth:'',copyMetadata:false,noImageProcessing:false},models,engine,models);await completed;
 assert.equal(m.session.phase,'completed',JSON.stringify(m.snapshot()));
 const middle=path.join(folder,'middle.png'),sequential=path.join(folder,'sequential.png');
 await run(['-i',image,'-o',middle,'-m',models,'-n',first,'-z',String(meta.nativeScale),'-a',String(meta.inputMultiple),...(meta.fullPrecision?['-F','1']:[]),'-g','0','-t','32','-f','png','-c','0'],'first');
 await run(['-i',middle,'-o',sequential,'-m',models,'-n',second,'-z','4','-w','16','-g','0','-t','32','-f','png','-c','0'],'second');
 const candidate=await sharp(path.join(m.session.output,m.session.items[0].name)).raw().toBuffer({resolveWithObject:true}),reference=await sharp(sequential).raw().toBuffer({resolveWithObject:true});
 assert.equal(candidate.info.width,16);assert.equal(candidate.info.height,16);assert.deepEqual(candidate.data,reference.data,'Combined worker changed order, intermediate pixels, final resize or encoding color order.');
 const evidence={scope:`Trained ${first} → IllustrationJaNai 4X, native ${meta.nativeScale*4}X, final 2X, 8×8 synthetic input. Pixel-identical to two ordered native invocations with final resize once. Software Vulkan; not real-page quality/performance.`,output:[16,16],equalPixels:true,modelLoadEvents:fs.readFileSync(path.join(folder,'logs','batch-'+m.session.id+'.log'),'utf8').split('\n').filter(line=>line.includes('model-load'))};
 const dest=path.join(root,'.test-artifacts/trained-two-stage',first);fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'evidence.json'),JSON.stringify(evidence,null,2));for(const name of ['first.log','second.log'])fs.copyFileSync(path.join(folder,name),path.join(dest,name));console.log(JSON.stringify(evidence));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(folder,{recursive:true,force:true}));
