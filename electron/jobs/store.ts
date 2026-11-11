import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function readEnvelope<T>(file:string):T {
  const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
  if(envelope.version!==1||typeof envelope.data!=='string'||crypto.createHash('sha256').update(envelope.data).digest('hex')!==envelope.sha256)throw Error('Invalid snapshot checksum');
  return JSON.parse(envelope.data);
}

export function atomicJSON<T>(file: string, value: T, validateExisting?:(value:T)=>void) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = JSON.stringify(value);
  const envelope = JSON.stringify({ version: 1, data, sha256: crypto.createHash('sha256').update(data).digest('hex') });
  const temporary = file + '.new';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, envelope); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // A recovered .bak must not be replaced with a torn primary on the next save.
  let validPrimary=false;try{const old=readEnvelope<T>(file);validateExisting?.(old);validPrimary=true;}catch{}
  if (validPrimary) {
    fs.copyFileSync(file, file + '.bak.new');
    const backup = fs.openSync(file + '.bak.new', 'r+');
    try { fs.fsyncSync(backup); } finally { fs.closeSync(backup); }
    fs.renameSync(file + '.bak.new', file + '.bak');
  }
  fs.renameSync(temporary, file);
  // POSIX directory durability; Windows has no portable directory fsync in Node.
  try { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch {}
}
export function readJSON<T>(file: string, validate?:(value:T)=>void): T {
  for (const candidate of [file, file + '.bak']) {
    try {
      const value=readEnvelope<T>(candidate);validate?.(value);return value;
    } catch {}
  }
  throw new Error('Session is unreadable; preserved for manual recovery: ' + file);
}
export async function hash(file: string): Promise<string> {
  const value = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
