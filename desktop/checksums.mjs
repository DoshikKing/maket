import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve(process.argv[2] ?? 'desktop/dist');
const lines = [];
for (const name of (await readdir(directory)).sort()) {
  if (!/\.(exe|deb|AppImage|tar\.gz|dmg|zip)$/.test(name)) continue;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
if (!lines.length) throw new Error('No desktop artifacts found');
await writeFile(path.join(directory, 'SHA256SUMS'), lines.join('\n') + '\n');
