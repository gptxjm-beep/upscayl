// Deliberate controller crash immediately after a durable first-stage journal.
const path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
const {BatchManager}=require('../../export/electron/jobs/manager.js');
const [folder,source,models,engine]=process.argv.slice(2),root=path.resolve(__dirname,'../..');
let exe=engine;
if(process.platform==='win32'){const runtime=fs.mkdtempSync(path.join(folder,'orphan-runtime-'));exe=path.join(runtime,path.basename(engine));fs.copyFileSync(engine,exe);for(const n of fs.readdirSync(path.dirname(engine)))if(n.endsWith('.dll'))fs.copyFileSync(path.join(path.dirname(engine),n),path.join(runtime,n));fs.copyFileSync(path.join(root,'node_modules/electron/dist/vk_swiftshader.dll'),path.join(runtime,'vulkan-1.dll'));}
const icd=path.join(root,'node_modules/electron/dist/vk_swiftshader_icd.json');
const m=new BatchManager(path.join(folder,'registry'),undefined,(_exe,args)=>spawn(exe,args,{windowsHide:true,stdio:'pipe',env:{...process.env,VK_ICD_FILENAMES:icd,VK_DRIVER_FILES:icd}}));
m.on('state',s=>{if(m.session?.items[0].stage==='stage1-complete'&&fs.existsSync(m.session.items[0].checkpoint.file)){fs.writeFileSync(path.join(folder,'crashed-session.json'),JSON.stringify({id:m.session.id,file:m.session.file,pid:m.session.pid,attempt:m.session.attempt}));process.exit(91);}});
const settings={batchFolderPath:source,outputPath:folder,model:'test-1x-half',useTwoModels:true,secondModel:'test-1x-add',gpuId:'0',saveImageAs:'png',scale:'1',compression:'0',tileSize:32,ttaMode:false,useCustomWidth:false,customWidth:'',copyMetadata:false,noImageProcessing:false};
m.create(settings,models,engine).catch(error=>{console.error(error);process.exit(92);});
