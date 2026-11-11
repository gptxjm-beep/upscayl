// Protocol fault-injection fixture; no GPU/AI quality claim. @JM3 GATE
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],control=get('-Q'),two=args.includes('-N'),manifest=get(two?'-P':'-L');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const send=line=>process.stdout.write(line+'\n');
async function wait(file){for(let i=0;i<1000;i++){if(fs.existsSync(path.join(control,file)))return;await delay(5);}throw Error('fixture ACK timeout '+file);}
(async()=>{
 const lines=fs.readFileSync(manifest,'utf8').trim().split('\n');let failed=false;
 for(let id=0;id<lines.length;id++){
  if(fs.existsSync(path.join(control,'pause'))){send('@JM3 GATE 1');break;}
  const fields=lines[id].split('\t'),source=Buffer.from(fields[0],'hex').toString(),output=Buffer.from(fields[1],'hex').toString();
  const wanted=process.env.JM_TEST_FAILURE_STAGE,marker=process.env.JM_TEST_ERROR_ONCE_MARKER,inject=path.basename(source).startsWith('0001')&&wanted&&(!marker||!fs.existsSync(marker));if(inject&&marker)fs.writeFileSync(marker,'1');
  if(two)send('@JM5 ADMIT '+id);send(`@JM3 START ${id} 1`);if(two&&fields[5]!=='2')send('@JM5 STAGE1 '+id);
  const failure=async stage=>{failed=true;send(`@JM2 ${id} 0 ${stage} -77`);if(two){await wait(id+'.final.ack');send('@JM5 RELEASE '+id);}};
  if(inject&&wanted==='global-model'){send('@JM5 FATAL model -1');await failure('model');break;}
  if(inject&&wanted==='disk'){send('@JM5 FATAL disk 28');await failure('encode');break;}
  if(inject&&wanted==='stageone'){await failure('stageone');continue;}
  if(two){
   const checkpoint=Buffer.from(fields[2],'hex').toString(),width=Number(fields[3]),height=Number(fields[4]);
   if(fields[5]!=='2'){await sharp(source).resize(width*Number(get('-z')),height*Number(get('-z'))).png().toFile(checkpoint+'.pending.png');send('@JM5 CHECKPOINT '+id);await wait(id+'.stage1.ack');}
   send('@JM5 STAGE2 '+id);
  }
  if(inject&&wanted==='stagetwo'){await failure('stagetwo');continue;}
  if(inject&&wanted==='encode'){fs.writeFileSync(output,'partial image');await failure('encode');continue;}
  const info=await sharp(source).metadata(),scale=Number(args.includes('-s')?get('-s'):get('-z'));await sharp(source).resize(info.width*scale,info.height*scale).png().toFile(output);send(`@JM2 ${id} 1 encode 0`);if(two){await wait(id+'.final.ack');send('@JM5 RELEASE '+id);}
 }
 process.exitCode=failed?2:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
