// Test-only pipeline simulator: several accepted images can be in flight.
const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const args=process.argv.slice(2);
const get=k => args[args.indexOf(k)+1];
const work=get('-Q');
const files=fs.readFileSync(get('-L'),'utf8').trim().split('\n').map(line => line.split('\t').map(p => Buffer.from(p,'hex').toString()));
const delay=ms => new Promise(r => setTimeout(r,ms));
async function main() {
 let next=0, failed=false, closed=false;const active=new Set();
 const trace=(event,id)=>process.stdout.write(`@JM3 ${event} ${id} ${Date.now()*1000}\n`);
 function admit(){
  let stop=fs.existsSync(path.join(work,'pause'));
  try{stop ||= Date.now()-fs.statSync(path.join(work,'lease')).mtimeMs>Number(process.env.JM_TEST_LEASE_MS||15000);}catch{stop=true;}
  if(!closed&&stop){closed=true;process.stdout.write(`@JM3 GATE ${Date.now()*1000}${[...active].map(i=>' '+i).join('')}\n`);}
  return !closed;
 }
 async function worker() {
  while(next<files.length && admit()) {
   const id=next++;const [input,output]=files[id];trace('LOAD',id);active.add(id);trace('START',id);
   await delay(12);active.delete(id);trace('END',id);
   try {
    if(path.basename(input).includes('fail')) throw Error('injected image failure');
    const info=await sharp(input).metadata();
    const width=args.includes('-w') ? Number(get('-w')) : info.width * Number(get('-s') || 4);
    await sharp(input).resize(width).toFile(output);
    process.stdout.write(`@JM1 ${id} 1\n`);
    // Deterministic fixture backpressure: let the host observe completions.
    while(fs.existsSync(output) && admit()) await delay(3);
   } catch {failed=true;process.stderr.write('fixture codec failure HRESULT=0x80004005\n');process.stdout.write(`@JM2 ${id} 0 decode -1\n`);}
  }
 }
 await Promise.all([worker(),worker(),worker()]);admit();
 process.exitCode=failed ? 2 : 0;
}
main().catch(e => {console.error(e);process.exitCode=3;});
