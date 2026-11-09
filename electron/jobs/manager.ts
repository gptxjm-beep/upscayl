import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import sharp from 'sharp';
import { atomicJSON, readJSON, hash } from './store';
import { getBatchArguments } from '../utils/get-arguments';
import { BatchUpscaylPayload } from '../../common/types/types';

export type Phase = 'running' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled';
type Item = { source: string; sourceHash: string; size: [number, number]; name: string;
  state: 'pending' | 'completed' | 'failed' | 'committing'; outputHash?: string; error?: string };
export type Session = { version: 1; id: string; source: string; output: string; file: string;
  modelDir: string; modelHash: string; engine: string; engineHash: string; settings: BatchUpscaylPayload;
  settingsHash: string; phase: Phase; updated: string; items: Item[]; attempt?: string; pid?: number };
// Avoid cached input handles preventing atomic adoption on Windows.
sharp.cache({ files: 0 });
const extensions = /\.(png|jpe?g|jfif|webp)$/i;

export class BatchManager extends EventEmitter {
  session?: Session;
  child?: ChildProcessWithoutNullStreams;
  private busy = false;
  private closing = false;
  private cancelRequested = false;
  private control?: string;
  private finishing: Promise<void> = Promise.resolve();
  constructor(public registry: string, private metadata: (input: string, output: string) => Promise<void> = async () => {},
    private launch = (engine:string,args:string[]) => spawn(engine,args,{windowsHide:true})) { super(); }
  private save() {
    const s = this.session!;
    s.updated = new Date().toISOString();
    atomicJSON(s.file, s);
    const pointer=path.join(this.registry, s.id + '.json');
    if(!fs.existsSync(pointer)) atomicJSON(pointer, { file: s.file, source: s.source });
    this.emit('state', this.snapshot());
  }
  snapshot() {
    const s = this.session;
    return s ? { id: s.id, phase: s.phase, completed: s.items.filter(i => i.state === 'completed').length,
      total: s.items.length, failed: s.items.filter(i => i.state === 'failed').length,
      lastError: s.items.find(i => i.error)?.error, source: s.source, output: s.output, settings: s.settings } : null;
  }
  discover(source?: string) {
    if (!fs.existsSync(this.registry)) return [];
    return fs.readdirSync(this.registry).filter(n => /^[a-f0-9-]+\.json$/.test(n)).flatMap(n => {
      try {
        const link = readJSON<{ file: string; source: string }>(path.join(this.registry, n));
        const s = readJSON<Session>(link.file);
        if(s.version !== 1 || (source && path.resolve(source) !== s.source)) return [];
        return [{ id: s.id, source: s.source, output: s.output, phase: s.phase,
          completed: s.items.filter(i => i.state === 'completed').length, total: s.items.length, settings: s.settings }];
      } catch(e) { this.emit('problem',String(e)); return []; }
    });
  }
  async create(settings: BatchUpscaylPayload, modelDir: string, engine: string) {
    if (this.child || this.busy || this.session && ['running','pausing','paused'].includes(this.session.phase)) throw new Error('Finish or cancel the current batch first.');
    this.busy = true; this.cancelRequested = false;
    try {
      const id = crypto.randomUUID();
      const source = path.resolve(settings.batchFolderPath);
      const baseName=`upscayl_${settings.saveImageAs}_${settings.model}_${settings.useCustomWidth ? settings.customWidth+'px' : settings.scale+'x'}`;
      const base=path.join(path.resolve(settings.outputPath),baseName);
      let output=base, suffix=2;
      while(fs.existsSync(output)) output=base+'_'+suffix++;
      const names = fs.readdirSync(source).filter(n => extensions.test(n) && fs.lstatSync(path.join(source,n)).isFile()).sort();
      if (!names.length) throw new Error('No supported images in selected folder.');
      const items: Item[] = [];
      for (const name of names) {
        if(this.cancelRequested) throw new Error('Batch preparation cancelled');
        const input = path.join(source,name);
        const info = await sharp(input, { failOn: 'warning', limitInputPixels: false }).metadata().catch(() => ({width:0,height:0}));
        items.push({ source: input, sourceHash: await hash(input), size: [info.width || 0,info.height || 0],
          name: `${path.parse(name).name}.${settings.saveImageAs}`, state: 'pending' });
      }
      const used=new Set<string>();
      for(const item of items) {
        const parsed=path.parse(item.name);let candidate=item.name,n=2;
        while(used.has(candidate.toLowerCase())) candidate=parsed.name+'_'+(n++)+parsed.ext;
        item.name=candidate;used.add(candidate.toLowerCase());
      }
      if(this.cancelRequested) throw new Error('Batch preparation cancelled');
      fs.mkdirSync(output, { recursive: true });
      let file = path.join(output, '.upscayl-session', 'state.json');
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { file = path.join(this.registry, id, 'state.json'); }
      this.session = { version:1, id, source, output, file, engine, engineHash:await hash(engine), modelDir,
        modelHash: await this.modelHash(modelDir,settings.model), settings: JSON.parse(JSON.stringify(settings)),
        settingsHash:crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex'), phase:'paused', updated:'', items };
      this.save();
    } finally { this.busy = false; }
    await this.resume();
  }
  private async modelHash(dir: string, model: string) {
    if(path.basename(model) !== model || /[\\/:]/.test(model)) throw new Error('Invalid model name');
    return (await hash(path.join(dir,model+'.param'))) + ':' + (await hash(path.join(dir,model+'.bin')));
  }
  async restart(id: string) {
    if(!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid session ID');
    const link=readJSON<{file:string}>(path.join(this.registry,id+'.json'));
    const previous=readJSON<Session>(link.file);
    if(previous.version !== 1 || previous.id !== id) throw new Error('Unsupported session');
    await this.create(previous.settings,previous.modelDir,previous.engine);
  }
  async restore(id: string) {
    if(this.child || this.busy || this.session && ['running','pausing','paused'].includes(this.session.phase)) throw new Error('A batch is already open.');
    if(!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid session ID');
    const link = readJSON<{file:string}>(path.join(this.registry,id+'.json'));
    const s = readJSON<Session>(link.file);
    if(s.version !== 1 || s.id !== id || s.file !== link.file) throw new Error('Unsupported session');
    if(s.pid) { try { process.kill(s.pid,0); throw new Error('Previous engine process is still active; wait before recovery.'); } catch(e) { if((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; } }
    // All file destinations must remain within their recorded roots.
    for(const i of s.items) if(path.dirname(i.source) !== s.source || path.basename(i.name) !== i.name) throw new Error('Unsafe session paths');
    this.session = s;
    s.phase = 'paused';
    await this.resume();
  }
  async resume() {
    if(this.child || this.busy || !this.session || this.closing) return;
    this.busy = true; this.cancelRequested = false;
    const s = this.session;
    try {
      if(crypto.createHash('sha256').update(JSON.stringify(s.settings)).digest('hex') !== s.settingsHash) throw new Error('Saved settings changed; session cannot be resumed.');
      if(await hash(s.engine) !== s.engineHash || await this.modelHash(s.modelDir,s.settings.model) !== s.modelHash) throw new Error('Engine/model changed. Restore the recorded files before resuming.');
      for(const i of s.items) {
        if(await hash(i.source) !== i.sourceHash) throw new Error('Source changed: ' + i.source);
        if(i.state === 'completed' || i.state === 'committing') {
          try {
            const out = path.join(s.output,i.name);
            await this.validate(i,out);
            if(await hash(out) !== i.outputHash) throw new Error('Output hash changed');
            i.state = 'completed';
          } catch { i.state = 'failed'; i.error = 'Recorded output is missing or corrupt; preserved. Resume writes a new attempt and never overwrites it.'; }
        }
      }
      for(const i of s.items) {
        if(i.state !== 'completed' && fs.existsSync(path.join(s.output,i.name))) {
          const parts=path.parse(i.name);let n=2,candidate='';
          do {candidate=parts.name+'_retry_'+(n++)+parts.ext;} while(fs.existsSync(path.join(s.output,candidate)) || s.items.some(other=>other!==i && other.name.toLowerCase()===candidate.toLowerCase()));
          i.name=candidate;
        }
      }
      if(this.cancelRequested) { s.phase='cancelled'; this.save(); return; }
      // Delete only work directories owned by this session, never final images.
      if(s.attempt && this.ownsWork(s.attempt,s)) fs.rmSync(s.attempt, {recursive:true,force:true});
      const pending = s.items.filter(i => i.state !== 'completed');
      if(!pending.length) { s.phase='completed'; this.save(); this.cleanup(); return; }
      const attempt = path.dirname(s.file) === path.join(s.output,'.upscayl-session') ? path.join(path.dirname(s.file),'work') : path.join(s.output,'.upscayl-work');
      fs.mkdirSync(attempt,{recursive:true});
      this.control = attempt; s.attempt = attempt;
      fs.writeFileSync(path.join(attempt,'lease'),'1');
      const manifest = pending.map(i => Buffer.from(i.source).toString('hex')+'\t'+Buffer.from(path.join(attempt,i.name)).toString('hex')).join('\n')+'\n';
      fs.writeFileSync(path.join(attempt,'manifest'),manifest);
      s.phase = 'running';
      for(const item of pending) {item.state='pending';item.error=undefined;}
      this.save();
      const options = s.settings;
      const args = getBatchArguments({ inputDir:s.source, outputDir:attempt, modelsPath:s.modelDir,
        model:options.model, gpuId:options.gpuId, saveImageAs:options.saveImageAs,
        scale:options.scale, customWidth:options.useCustomWidth ? options.customWidth : '',
        compression:options.compression, tileSize:options.tileSize, ttaMode:options.ttaMode });
      const command=[...args.filter(Boolean),'-L',path.join(attempt,'manifest'),'-Q',attempt];
      this.log('start',{engine:s.engine,args:command,inputs:pending.map((i,id)=>({id,source:i.source})),modelHash:s.modelHash});
      const child = this.launch(s.engine,command);
      this.child = child; s.pid = child.pid; this.save();
      const lease = setInterval(() => { try { fs.utimesSync(path.join(attempt,'lease'),new Date(),new Date()); } catch {} },2000);
      let stderrTail='';
      let buffered = ''; const seen = new Set<number>();
      this.finishing = Promise.resolve();
      child.stdout.on('data',data => {
        buffered += data.toString();
        let end;
        while((end = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0,end).trim(); buffered=buffered.slice(end+1);
          const match = /^@JM([12]) (\d+) ([01])(?: ([a-z]+) (-?\d+))?$/.exec(line);
          if(!match) continue;
          const index=Number(match[2]);
          if(!pending[index] || seen.has(index)) continue;
          seen.add(index);
          this.finishing = this.finishing.then(async () => {
            const item = pending[index];
            try {
              this.log('image',{id:index,source:item.source,ok:match[3]==='1',stage:match[4] || 'legacy',code:match[5],stderr:stderrTail});
              if(match[3] !== '1') throw new Error(`Image ${path.basename(item.source)} failed during ${match[4] || 'processing'} (code ${match[5] || 'unknown'}). ${stderrTail.slice(-1200)}`);
              await this.commit(item,path.join(attempt,item.name));
            } catch(e) { item.state='failed'; item.error=String(e); this.save(); }
          }).catch(e => { this.emit('problem',String(e)); this.pause(); });
        }
      });
      child.stderr.on('data',data => {stderrTail=(stderrTail+data.toString()).slice(-16384);this.log('stderr',data.toString());this.emit('log',data.toString());});
      let spawnError = '';
      child.on('error',e => { spawnError=String(e); });
      child.on('close',async (code,signal) => {
        clearInterval(lease);
        this.log('exit',{code,signal,error:spawnError});
        try {
          await this.finishing;
          this.child=undefined; s.pid=undefined;
          if(this.control) {fs.rmSync(this.control,{recursive:true,force:true});this.control=undefined;s.attempt=undefined;}
          if(s.phase === 'cancelled') { this.save(); return; }
          // A per-file success event is emitted only after the encoder completes.
          if(spawnError || signal || code !== 0 && code !== 2) throw new Error(spawnError || `Engine ended: ${code} ${signal || ''}`);
          if(s.items.every(i => i.state === 'completed')) { s.phase='completed'; this.save(); this.cleanup(); }
          else { const errors=s.items.some(i=>i.state==='failed'); s.phase = errors ? 'failed' : s.phase === 'pausing' ? 'paused' : 'failed'; this.save(); }
        } catch(e) { s.phase='failed'; try { this.save(); } catch(persist) { this.emit('problem',String(persist)); } this.emit('problem',String(e)); }
        finally { this.child=undefined; this.emit('settled'); }
      });
    } catch(e) { s.phase='paused'; this.save(); throw e; }
    finally { this.busy=false; }
  }
  private async validate(item: Item, file: string) {
    const s=this.session!; const o=s.settings;
    const expected: [number,number] = o.useCustomWidth ? [Number(o.customWidth), Math.floor(item.size[1]*Number(o.customWidth)/item.size[0])] : [item.size[0]*Number(o.scale),item.size[1]*Number(o.scale)];
    const image = sharp(file,{failOn:'warning',limitInputPixels:false});
    const info = await image.metadata();
    if(info.width !== expected[0] || info.height !== expected[1] || info.format !== ({jpg:'jpeg',png:'png',webp:'webp'}[o.saveImageAs])) throw new Error('Invalid output dimensions/format');
    // Force full decode without keeping a whole raw image in JavaScript memory.
    await image.stats();
  }
  private async commit(item: Item, temporary: string) {
    const s=this.session!;
    if(await hash(item.source) !== item.sourceHash) throw new Error('Source changed during processing');
    await this.validate(item,temporary);
    if(s.settings.copyMetadata) await this.metadata(item.source,temporary);
    await this.validate(item,temporary);
    item.outputHash=await hash(temporary); item.state='committing'; this.save();
    const fd=fs.openSync(temporary,'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const final=path.join(s.output,item.name);
    // link is atomic and fails if a destination exists; no overwrite race.
    fs.linkSync(temporary,final);
    fs.unlinkSync(temporary);
    try { const dir=fs.openSync(s.output,'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch {}
    item.state='completed'; item.error=undefined; this.save();
  }
  pause() {
    const s=this.session;
    if(!s || s.phase !== 'running' || !this.control) return;
    // Stop admission before persisting, so a slow disk cannot admit a whole folder.
    fs.writeFileSync(path.join(this.control,'pause'),'1');
    s.phase='pausing'; this.save();
  }
  cancel() {
    if(!this.busy && !this.child && (!this.session || ['completed','cancelled'].includes(this.session.phase))) return;
    this.cancelRequested=true;
    if(!this.session) { this.emit('state',null); return; }
    this.session.phase='cancelled'; this.save(); this.child?.kill();
  }
  async shutdown() {
    this.closing=true;
    while(this.busy) await new Promise(resolve => setTimeout(resolve,25));
    if(this.child) { this.pause(); await new Promise<void>(resolve => this.once('settled',resolve)); }
  }
  private ownsWork(folder:string,s:Session) {
    return folder === path.join(s.output,'.upscayl-session','work') || folder === path.join(s.output,'.upscayl-work') || path.dirname(folder) === s.output && path.basename(folder).startsWith('.upscayl-work-');
  }
  private log(kind:string,data:unknown) {
    const s=this.session;if(!s)return;
    try {
      const folder=path.join(path.dirname(this.registry),'logs');fs.mkdirSync(folder,{recursive:true});
      fs.appendFileSync(path.join(folder,'batch-'+s.id+'.log'),JSON.stringify({at:new Date().toISOString(),job:s.id,kind,data})+'\n','utf8');
    } catch(error) { this.emit('problem','Cannot write batch diagnostic log: '+String(error)); }
  }
  private cleanup() {
    const s=this.session!;
    if(!s.items.every(i => i.state === 'completed')) return;
    if(s.attempt && this.ownsWork(s.attempt,s)) fs.rmSync(s.attempt,{recursive:true,force:true});
    for(const suffix of ['', '.bak','.new','.bak.new']) {
      fs.rmSync(s.file+suffix,{force:true});
      fs.rmSync(path.join(this.registry,s.id+'.json')+suffix,{force:true});
    }
    try { fs.rmdirSync(path.dirname(s.file)); } catch {}
  }
}
