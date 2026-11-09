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
 let next=0, failed=false;
 async function worker() {
  while(next<files.length && !fs.existsSync(path.join(work,'pause'))) {
   const id=next++;const [input,output]=files[id];
   await delay(12);
   try {
    if(path.basename(input).includes('fail')) throw Error('injected image failure');
    const info=await sharp(input).metadata();
    const width=args.includes('-w') ? Number(get('-w')) : info.width * Number(get('-s') || 4);
    await sharp(input).resize(width).toFile(output);
    process.stdout.write(`@JM1 ${id} 1\n`);
    // Deterministic fixture backpressure: let the host observe completions.
    while(fs.existsSync(output) && !fs.existsSync(path.join(work,'pause'))) await delay(3);
   } catch {failed=true;process.stdout.write(`@JM1 ${id} 0\n`);}
  }
 }
 await Promise.all([worker(),worker(),worker()]);
 process.exitCode=failed ? 2 : 0;
}
main().catch(e => {console.error(e);process.exitCode=3;});
