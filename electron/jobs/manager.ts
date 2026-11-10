import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import sharp from 'sharp';
import { atomicJSON, readJSON, hash } from './store';
import { ownsEngine } from './process-owner';
import { getBatchArguments } from '../utils/get-arguments';
import { BatchUpscaylPayload } from '../../common/types/types';

export type Phase = 'running' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled';
type Item = { source: string; sourceHash: string; size: [number, number]; name: string;
  state: 'pending' | 'processing' | 'saving' | 'completed' | 'failed' | 'committing'; outputHash?: string; error?: string };
export type Session = { version: 1; id: string; source: string; output: string; file: string;
  modelDir: string; modelHash: string; engine: string; engineHash: string; settings: BatchUpscaylPayload;
  settingsHash: string; phase: Phase; updated: string; items: Item[]; attempt?: string; pid?: number; error?: string;cancelConfirmed?:boolean };
// Avoid cached input handles preventing atomic adoption on Windows.
sharp.cache({ files: 0 });
const extensions = /\.(png|jpe?g|jfif|webp)$/i;

export class BatchManager extends EventEmitter {
  session?: Session;
  child?: ChildProcessWithoutNullStreams;
  private busy = false;
  private closing = false;
  private cancelRequested = false;
  private cancelling = false;
  private settling = false;
  private gateClosed = false;
  private pauseRequestedAt?: [number,number];
  private completedAtPause = 0;
  private reportedProblems = new Set<string>();
  private control?: string;
  private finishing: Promise<void> = Promise.resolve();
  constructor(public registry: string, private metadata: (input: string, output: string) => Promise<void> = async () => {},
    private launch = (engine:string,args:string[]) => spawn(engine,args,{windowsHide:true})) { super(); }
  hasActiveBatch() {
    return this.busy || this.settling || !!this.child || !!this.session && ['running','pausing','paused','failed'].includes(this.session.phase);
  }
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
      lastError: s.error || s.items.find(i => i.error)?.error, source: s.source, output: s.output, settings: s.settings,
      engineStopped: !this.child && !this.settling, gateClosed: this.gateClosed } : null;
  }
  discover(source?: string) {
    if (!fs.existsSync(this.registry)) return [];
    return fs.readdirSync(this.registry).filter(n => /^[a-f0-9-]+\.json$/.test(n)).flatMap(n => {
      try {
        const link = readJSON<{ file: string; source: string }>(path.join(this.registry, n));
        const s = readJSON<Session>(link.file);
        if(s.cancelConfirmed) {
          this.validateRecord(s,s.id,link.file);this.requireStopped(s);this.removeSession(s);return [];
        }
        if(s.version !== 1 || ['completed','cancelled'].includes(s.phase) || (source && path.resolve(source) !== s.source)) return [];
        return [{ id: s.id, source: s.source, output: s.output, phase: s.phase,
          completed: s.items.filter(i => i.state === 'completed').length, total: s.items.length, settings: s.settings }];
      } catch(e) { const message=String(e);if(!this.reportedProblems.has(message)){this.reportedProblems.add(message);this.emit('problem',message);} return []; }
    });
  }
  async create(settings: BatchUpscaylPayload, modelDir: string, engine: string) {
    if (this.child || this.busy || this.cancelling || this.settling || this.session && ['running','pausing','paused'].includes(this.session.phase)) throw new Error('Finish or cancel the current batch first.');
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
      const engineHash=await hash(engine), modelHash=await this.modelHash(modelDir,settings.model);
      if(this.cancelRequested || this.closing) throw new Error('Batch preparation cancelled');
      fs.mkdirSync(output, { recursive: true });
      let file = path.join(output, '.upscayl-session', 'state.json');
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { file = path.join(this.registry, id, 'state.json'); }
      this.session = { version:1, id, source, output, file, engine, engineHash, modelDir,
        modelHash, settings: JSON.parse(JSON.stringify(settings)),
        settingsHash:crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex'), phase:'paused', updated:'', items };
      this.save();
    } finally { this.busy = false; }
    if(!this.cancelRequested && !this.closing) await this.resume();
  }
  private async modelHash(dir: string, model: string) {
    if(path.basename(model) !== model || /[\\/:]/.test(model)) throw new Error('Invalid model name');
    return (await hash(path.join(dir,model+'.param'))) + ':' + (await hash(path.join(dir,model+'.bin')));
  }
  async restart(id: string, replacementEngine?:string, replacementModels?:string) {
    if(!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid session ID');
    const link=readJSON<{file:string}>(path.join(this.registry,id+'.json'));
    const previous=readJSON<Session>(link.file);
    this.validateRecord(previous,id,link.file);this.requireStopped(previous);
    const engine=replacementEngine || previous.engine;
    this.requireInferenceGate(engine);
    await this.create(previous.settings,replacementModels || previous.modelDir,engine);
    // The replacement journal/engine now exists. Preserve all old final images.
    this.removeSession(previous);
  }
  async restore(id: string) {
    if(this.child || this.busy || this.session && ['running','pausing','paused'].includes(this.session.phase)) throw new Error('A batch is already open.');
    if(!/^[a-f0-9-]+$/.test(id)) throw new Error('Invalid session ID');
    const link = readJSON<{file:string}>(path.join(this.registry,id+'.json'));
    const s = readJSON<Session>(link.file);
    this.validateRecord(s,id,link.file);this.requireStopped(s);
    if(s.phase==='cancelled'||s.cancelConfirmed)throw new Error('This batch was permanently cancelled.');
    this.requireInferenceGate(s.engine);
    this.session = s;
    s.phase = 'paused';
    await this.resume();
  }
  async resume() {
    if(this.child || this.busy || this.cancelling || this.settling || !this.session || this.closing || this.session.cancelConfirmed || ['completed','cancelled'].includes(this.session.phase)) return;
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
      // Closing may have arrived while Resume was hashing/validating files.
      // Do not start a new engine just to stop it again after that preflight.
      if(this.closing) {s.phase='paused';this.save();return;}
      // Delete only work directories owned by this session, never final images.
      if(s.attempt && this.ownsWork(s.attempt,s)) fs.rmSync(s.attempt, {recursive:true,force:true});
      const pending = s.items.filter(i => i.state !== 'completed');
      this.gateClosed=false;this.pauseRequestedAt=undefined;
      s.error=undefined;
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
      this.log('spawn',{pid:child.pid});
      const lease = setInterval(() => { try { fs.utimesSync(path.join(attempt,'lease'),new Date(),new Date()); } catch {} },2000);
      let stderrTail='';
      let buffered = ''; const seen = new Set<number>();
      this.finishing = Promise.resolve();
      child.stdout.on('data',data => {
        buffered += data.toString();
        let end;
        while((end = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0,end).trim(); buffered=buffered.slice(end+1);
          const trace=/^@JM3 (LOAD|START|END|DEFER) (\d+) (\d+)$/.exec(line);
          if(trace) {
            const id=Number(trace[2]);if(!pending[id])continue;
            this.log('inference',{event:trace[1],id,source:pending[id].source,tick:trace[3]});
            if(trace[1]==='START') {pending[id].state='processing';this.emit('inference-start',id);}
            if(trace[1]==='END') pending[id].state='saving';
            if(trace[1]==='DEFER') pending[id].state='pending';
            this.emit('native-trace',{event:trace[1],id,tick:trace[3]});continue;
          }
          const gate=/^@JM3 GATE (\d+)((?: \d+)*)$/.exec(line);
          if(gate) {
            this.gateClosed=true;
            const active=gate[2].trim()?gate[2].trim().split(' ').map(Number):[];
            const elapsed=this.pauseRequestedAt?process.hrtime(this.pauseRequestedAt):undefined;
            const evidence={tick:gate[1],active,awaitingSave:pending.flatMap((item,id)=>['saving','committing'].includes(item.state)?[id]:[]),latencyMs:elapsed?elapsed[0]*1000+elapsed[1]/1e6:null};
            this.log('pause-gate',evidence);this.emit('gate-closed',evidence);continue;
          }
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
        this.settling=true;
        clearInterval(lease);
        this.log('exit',{code,signal,error:spawnError});
        try {
          await this.finishing;
          this.child=undefined; s.pid=undefined;
          if(this.control) {fs.rmSync(this.control,{recursive:true,force:true});this.control=undefined;s.attempt=undefined;}
          if(s.phase === 'cancelled') { this.removeSession(s); return; }
          // A per-file success event is emitted only after the encoder completes.
          if(spawnError || signal || code !== 0 && code !== 2) throw new Error(spawnError || `Engine ended: ${code} ${signal || ''}`);
          if(s.items.every(i => i.state === 'completed')) { s.phase='completed'; this.save(); this.cleanup(); }
          else {
            const errors=s.items.some(i=>i.state==='failed');
            s.phase = errors ? 'failed' : s.phase === 'pausing' && this.gateClosed ? 'paused' : 'failed';
            for(const item of s.items)if(item.state==='processing')item.state='pending';
            if(s.phase==='failed'&&!errors)s.error='Engine exited with unfinished images before a confirmed inference gate closure.';
            this.settling=false;this.save();
          }
          this.log('drained',{phase:s.phase,completedAfterPause:this.pauseRequestedAt===undefined?null:this.snapshot()!.completed-this.completedAtPause,engineStopped:true});
        } catch(e) { s.phase=s.cancelConfirmed?'cancelled':'failed'; s.error=String(e); try { this.save(); } catch(persist) { this.emit('problem',String(persist)); } this.emit('problem',String(e)); }
        finally { this.child=undefined;this.settling=false; this.emit('settled'); }
      });
    } catch(e) { s.phase=this.cancelRequested?'cancelled':'failed';s.error=String(e);this.save();throw e; }
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
    item.state='saving';
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
    this.pauseRequestedAt=process.hrtime();this.completedAtPause=this.snapshot()!.completed;
    this.log('pause-request',{completed:this.completedAtPause});
    s.phase='pausing'; this.save();
  }
  async cancel() {
    if(!this.busy && !this.child && (!this.session || ['completed','cancelled'].includes(this.session.phase))) return;
    if(this.cancelling)return;
    this.cancelling=true;this.cancelRequested=true;
    try {
      if(this.session&&!['completed','cancelled'].includes(this.session.phase)){
        this.session.phase='cancelled';this.session.cancelConfirmed=true;
        try{this.save();}catch(error){this.emit('problem','Cannot persist cancellation; stopping engine before cleanup: '+String(error));}
      }
      if(this.child) {
        const ended=this.awaitSettled(10000);
        this.child.kill('SIGKILL');await ended;
      }
      while(this.busy)await new Promise(resolve=>setTimeout(resolve,10));
      if(this.session?.phase==='cancelled')this.removeSession(this.session);
      if(!this.session)this.emit('state',null);
    } finally {this.cancelling=false;}
  }
  private awaitSettled(timeoutMs:number) {
    return new Promise<void>((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>{this.off('settled',done);reject(new Error('Engine shutdown or pending output validation exceeded the deadline; recovery journal retained.'));},timeoutMs);
      this.once('settled',done);
    });
  }
  async shutdown(graceMs=120000) {
    this.closing=true;
    while(this.busy) await new Promise(resolve => setTimeout(resolve,25));
    if(this.child) {
      this.pause();
      try {await this.awaitSettled(graceMs);} catch {
        this.log('shutdown-timeout',{graceMs});
        if(this.child){const ended=this.awaitSettled(10000);this.child.kill('SIGKILL');await ended;}
      }
    }
  }
  private ownsWork(folder:string,s:Session) {
    return folder === path.join(s.output,'.upscayl-session','work') || folder === path.join(s.output,'.upscayl-work') || path.dirname(folder) === s.output && path.basename(folder).startsWith('.upscayl-work-');
  }
  private requireStopped(s:Session) {
    if(s.pid && ownsEngine(s.pid,s.attempt || path.join(s.output,'.upscayl-session','work')))throw new Error('Previous engine process is still active; wait before recovery.');
  }
  private requireInferenceGate(engine:string) {
    if(!fs.readFileSync(engine).includes(Buffer.from('@JM3 GATE')))throw new Error('The recorded engine uses an older Pause protocol. Start From Beginning with jm.3; existing results and this record are preserved.');
  }
  private validateRecord(s:Session,id:string,file:string) {
    if(s.version!==1||s.id!==id||s.file!==file||!/^[a-f0-9-]+$/.test(id))throw new Error('Unsupported session');
    const directory=path.dirname(file);
    if(directory!==path.join(s.output,'.upscayl-session')&&directory!==path.join(this.registry,id))throw new Error('Unsafe journal path');
    if(!Array.isArray(s.items)||!s.items.length)throw new Error('Invalid saved image list');
    for(const i of s.items)if(path.dirname(i.source)!==s.source||path.basename(i.name)!==i.name)throw new Error('Unsafe session paths');
    if(s.attempt&&!this.ownsWork(s.attempt,s))throw new Error('Unsafe work path');
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
    this.removeSession(s);
  }
  private removeSession(s:Session) {
    if(s.attempt && this.ownsWork(s.attempt,s)) fs.rmSync(s.attempt,{recursive:true,force:true});
    for(const suffix of ['', '.bak','.new','.bak.new']) {
      fs.rmSync(s.file+suffix,{force:true});
      fs.rmSync(path.join(this.registry,s.id+'.json')+suffix,{force:true});
    }
    try { fs.rmdirSync(path.dirname(s.file)); } catch {}
  }
}
