const path = require('node:path');
const fs = require('node:fs/promises');
require('electron'); // Resolve/download the pinned native Electron once, with its verified checksums.
module.exports = {
  electronDist: path.join(path.dirname(require.resolve('electron/package.json')), 'dist'),
  appId: 'com.doshikking.maket',
  productName: 'maket',
  asar: false, // PostgreSQL executables and their relative libraries must remain regular files.
  npmRebuild: false,
  directories: { output: 'dist', buildResources: '.build' },
  files: ['main.cjs', 'runtime.cjs', 'server-entry.cjs', 'package.json'],
  extraResources: [{ from: 'THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' }],
  async afterPack(context) {
    // electron-builder excludes a root node_modules from extraResources; standalone needs it intact.
    await fs.cp(
      path.join(__dirname, '.build', 'server'),
      path.join(context.packager.getResourcesDir(context.appOutDir), 'server'),
      { recursive: true },
    );
    if (process.platform !== 'win32') {
      async function normalize(directory) {
        await fs.chmod(directory, 0o755);
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) await normalize(file);
          else if (entry.isFile()) {
            const info = await fs.stat(file);
            await fs.chmod(file, info.mode & 0o111 ? 0o755 : 0o644);
          }
        }
      }
      await normalize(context.appOutDir);
    }
  },
  artifactName: 'maket-${version}-${os}-${arch}.${ext}',
  mac: {
    icon: '.build/icon.png',
    category: 'public.app-category.productivity',
    identity: null,
    target: ['dmg'],
  },
  win: { icon: '.build/icon.ico', target: ['nsis'] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
  },
  linux: {
    icon: '.build/icon.png',
    category: 'Office',
    target: ['deb'],
    maintainer: 'DoshikKing <DoshikKing@users.noreply.github.com>',
    executableName: 'maket',
  },
};
