import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const { build, Platform } = require('electron-builder');
const config = require('./electron-builder.cjs');
const desktop = fileURLToPath(new URL('.', import.meta.url));
const metadata = require('./package.json');
const run = promisify(execFile);
const platform = Platform.current();
const common = { projectDir: desktop, publish: 'never' };
await build({ ...common, config });
const targets = { win32: ['portable'], linux: ['AppImage', 'tar.gz'], darwin: ['zip'] }[
  process.platform
];
const portable = {
  ...config,
  artifactName: 'maket-${version}-${os}-${arch}-portable.${ext}',
  extraResources: [...config.extraResources, { from: '.build/portable-mode', to: 'portable-mode' }],
};
await build({ ...common, targets: platform.createTarget(targets), config: portable });
if (process.platform === 'darwin') {
  // A launcher keeps portable data next to the archive even under macOS App Translocation.
  const staging = path.join(desktop, '.build', 'portable-mac');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const app = path.join(
    desktop,
    'dist',
    process.arch === 'arm64' ? 'mac-arm64' : 'mac',
    'maket.app',
  );
  await run('ditto', [app, path.join(staging, 'maket.app')]);
  await writeFile(
    path.join(staging, 'maket-portable.command'),
    '#!/bin/sh\nset -eu\nMAKET_PORTABLE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexport MAKET_PORTABLE_DIR\nexec "$MAKET_PORTABLE_DIR/maket.app/Contents/MacOS/maket"\n',
    { mode: 0o755 },
  );
  await writeFile(
    path.join(staging, 'README.txt'),
    'Распакуйте архив целиком и запустите maket-portable.command. Данные хранятся в maket-data рядом с приложением. Не запускайте приложение из архива или образа DMG.\n',
  );
  const zip = path.join(
    desktop,
    'dist',
    `maket-${metadata.version}-mac-${process.arch}-portable.zip`,
  );
  await rm(zip, { force: true });
  await run('ditto', ['-c', '-k', '--sequesterRsrc', staging, zip]);
}
