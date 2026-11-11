// Physical-GPU acceptance runner for the same durable manager used by the app.
// It does not replace UI processing or perform a raw-engine benchmark.
const {parseArgs}=require('node:util'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const {readJSON}=require('../../export/electron/jobs/store.js');
const options={engine:{type:'string'},models:{type:'string'},'second-models':{type:'string'},model:{type:'string'},'second-model':{type:'string'},input:{type:'string'},output:{type:'string'},scale:{type:'string',default:'2'},tile:{type:'string',default:'200'},gpu:{type:'string',default:'0'},'nvidia-index':{type:'string',default:'0'},tta:{type:'boolean',default:false},'pause-stage':{type:'string'},resume:{type:'string'},'confirm-gpu-test':{type:'boolean'}};
(async()=>{
 const {values:a}=parseArgs({options});for(const name of ['engine','models','model','second-model','input','output'])if(!a[name])throw Error('Required: --'+name);
 if(process.platform!=='win32'||!a['confirm-gpu-test'])throw Error('Run explicitly on Windows with --confirm-gpu-test.');
 if(process.env.VK_ICD_FILENAMES||process.env.VK_DRIVER_FILES)throw Error('Unset Vulkan ICD overrides before a physical GPU acceptance test.');
 const gpu=execFileSync('nvidia-smi',['-i',a['nvidia-index'],'--query-gpu=name,driver_version,memory.total','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:10000}).trim();if(!gpu.includes('RTX 3060 Ti'))throw Error('Expected RTX 3060 Ti; found '+gpu);
 if(a['pause-stage']&&!['STAGE1','CHECKPOINT','STAGE2','VERIFY'].includes(a['pause-stage']))throw Error('Invalid --pause-stage.');
 const input=path.resolve(a.input),single=fs.statSync(input).isFile(),source=single?path.dirname(input):input,output=path.resolve(a.output);
 const relation=path.relative(source,output);
 if(!relation||!(path.isAbsolute(relation)||relation==='..'||relation.startsWith('..'+path.sep)))throw Error('Use an output folder separate from and outside the input folder.');
 fs.mkdirSync(output,{recursive:true});const registry=path.join(output,'.jm5-acceptance','registry'),m=new BatchManager(registry);let requested=false,previous='',start=process.hrtime.bigint(),engineStart;
 m.on('state',state=>{if(m.child&&!engineStart)engineStart=process.hrtime.bigint();const key=state.phase+':'+state.completed;if(key!==previous){previous=key;console.log(JSON.stringify({id:state.id,phase:state.phase,completed:state.completed,total:state.total}));}});
 m.on('native-trace',event=>{if(!requested&&event.event===a['pause-stage']){requested=true;m.pause();}});m.on('problem',error=>console.error(String(error)));
 const done=new Promise(resolve=>m.once('settled',resolve));
 if(a.resume){const candidate=m.discover(source,single?input:undefined).find(s=>s.id===a.resume);if(!candidate)throw Error('Resume ID does not belong to this source or is not recoverable.');await m.restore(a.resume,path.resolve(a.engine),path.resolve(a.models),path.resolve(a['second-models']||a.models));}
 else await m.create({batchFolderPath:source,...(single?{singleImage:input}:{}),outputPath:output,model:a.model,useTwoModels:true,secondModel:a['second-model'],gpuId:a.gpu,saveImageAs:'png',scale:a.scale,compression:'0',tileSize:Number(a.tile),ttaMode:a.tta,useCustomWidth:false,customWidth:'',copyMetadata:false,noImageProcessing:false},path.resolve(a.models),path.resolve(a.engine),path.resolve(a['second-models']||a.models));
 if(m.child)await done;
 const report={scope:'Physical GPU acceptance job, including journaling and validation; not raw-engine timing.',gpu,jobWallSeconds:Number(process.hrtime.bigint()-start)/1e9,processWallWithHostAckSeconds:engineStart?Number(process.hrtime.bigint()-engineStart)/1e9:null,state:m.snapshot(),journal:m.session?.file,registry};
 const file=path.join(output,'acceptance-'+m.session.id+'-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log('Saved '+file);if(m.session.phase==='failed')process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
