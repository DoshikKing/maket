import { spawn } from 'node:child_process';
import { cp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
const desktop = fileURLToPath(new URL('.', import.meta.url)),
  root = path.dirname(desktop);
const build = path.join(desktop, '.build'),
  target = path.join(build, 'server');
// A separate Next output directory and separate npm lockfile keep desktop out of web/Docker builds.
const snapshots = await Promise.all(
  ['next-env.d.ts', 'tsconfig.json'].map(async (name) => [
    name,
    await readFile(path.join(root, name)),
  ]),
);
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
      {
        cwd: root,
        env: {
          ...process.env,
          MAKET_DESKTOP_BUILD: '1',
          APP_URL: '',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Desktop Next build exited ${code}`)),
    );
  });
} finally {
  for (const [name, content] of snapshots) await writeFile(path.join(root, name), content);
}
await rm(target, { recursive: true, force: true });
await mkdir(build, { recursive: true });
await cp(path.join(root, '.next-desktop', 'standalone'), target, { recursive: true });
await cp(path.join(root, '.next-desktop', 'static'), path.join(target, '.next-desktop', 'static'), {
  recursive: true,
});
// Next copies loaded dotenv files into standalone output. Never distribute local/server credentials.
for (const name of await readdir(target))
  if (name === '.env' || name.startsWith('.env.'))
    await rm(path.join(target, name), { force: true });
for (const name of [
  '.prisma',
  'dotenv',
  '@prisma/adapter-pg',
  '@prisma/driver-adapter-utils',
  '@prisma/debug',
  'postgres-array',
  'zod',
]) {
  await cp(path.join(root, 'node_modules', name), path.join(target, 'node_modules', name), {
    recursive: true,
  });
}
// Tracing copies executable dependencies, not necessarily their accompanying notices.
async function copyLicenses(relative = '') {
  const source = path.join(root, 'node_modules', relative),
    destination = path.join(target, 'node_modules', relative);
  for (const file of await readdir(source, { withFileTypes: true }).catch(() => [])) {
    if (file.isFile() && /^(licen[cs]e|copying|copyright|notice)(?:[._-]|$)/i.test(file.name))
      await cp(path.join(source, file.name), path.join(destination, file.name));
  }
  for (const folder of await readdir(destination, { withFileTypes: true }))
    if (folder.isDirectory()) await copyLicenses(path.join(relative, folder.name));
}
await copyLicenses();
await cp(path.join(root, 'prisma', 'migrations'), path.join(target, 'prisma', 'migrations'), {
  recursive: true,
});
await mkdir(path.join(target, 'scripts'), { recursive: true });
for (const name of ['migrate.mjs', 'database-config.mjs'])
  await cp(path.join(root, 'scripts', name), path.join(target, 'scripts', name));
await sharp(path.join(desktop, 'icon.svg')).resize(1024).png().toFile(path.join(build, 'icon.png'));
const image = await sharp(path.join(desktop, 'icon.svg')).resize(256).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(image.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(path.join(build, 'icon.ico'), Buffer.concat([header, image]));
await writeFile(path.join(build, 'portable-mode'), 'maket portable edition\n');
const config = JSON.parse(
  await readFile(path.join(target, '.next-desktop', 'required-server-files.json'), 'utf8'),
);
if (config.config.basePath !== '' || config.config.env.NEXT_PUBLIC_MAKET_DESKTOP !== '1')
  throw new Error('Desktop build must use its own root path and local mode');
await writeFile(
  path.join(target, '.next-desktop', 'desktop-config.json'),
  JSON.stringify(config.config),
);
console.log('Desktop server prepared in desktop/.build/server (no dotenv files)');
