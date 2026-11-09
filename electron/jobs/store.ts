import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function atomicJSON(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = JSON.stringify(value);
  const envelope = JSON.stringify({ version: 1, data, sha256: crypto.createHash('sha256').update(data).digest('hex') });
  const temporary = file + '.new';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, envelope); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, file + '.bak.new');
    const backup = fs.openSync(file + '.bak.new', 'r+');
    try { fs.fsyncSync(backup); } finally { fs.closeSync(backup); }
    fs.renameSync(file + '.bak.new', file + '.bak');
  }
  fs.renameSync(temporary, file);
  // POSIX directory durability; Windows has no portable directory fsync in Node.
  try { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch {}
}
export function readJSON<T>(file: string): T {
  for (const candidate of [file, file + '.bak']) {
    try {
      const envelope = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (envelope.version !== 1 || crypto.createHash('sha256').update(envelope.data).digest('hex') !== envelope.sha256) continue;
      return JSON.parse(envelope.data);
    } catch {}
  }
  throw new Error('Session is unreadable; preserved for manual recovery: ' + file);
}
export async function hash(file: string): Promise<string> {
  const value = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
