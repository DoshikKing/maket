const { app, BrowserWindow, Menu, dialog, shell, clipboard, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startRuntime, portableDirectory } = require('./runtime.cjs');
const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '.build');
const portable = portableDirectory({
  resourcesPath: resources,
  executable: process.execPath,
  portable: fs.existsSync(path.join(resources, 'portable-mode')),
});
const dataDir = portable
  ? path.join(portable, 'maket-data')
  : path.join(app.getPath('appData'), 'maket-desktop');
let filesystemError;
try {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dataDir, 'browser'), { recursive: true, mode: 0o700 });
  app.setPath('userData', path.join(dataDir, 'browser'));
} catch (error) {
  filesystemError = error;
}
app.setName('maket');
let runtime,
  starting,
  stopping = false,
  window,
  localSession;
if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on('window-all-closed', () => shutdown());
  app.on('before-quit', (event) => {
    event.preventDefault();
    const windows = BrowserWindow.getAllWindows();
    if (windows.length) windows.forEach((w) => w.close());
    else shutdown();
  });
  app
    .whenReady()
    .then(() => {
      if (filesystemError) throw filesystemError;
      return launch();
    })
    .catch(failed);
}
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  try {
    await starting?.catch(() => {});
    await runtime?.stop();
  } catch (error) {
    console.error(error.message);
  }
  app.exit(exitCode);
}
async function failed(error) {
  if (!stopping)
    dialog.showErrorBox(
      'Не удалось запустить maket',
      `${error.message}\n\nКаталог данных:\n${dataDir}\n\nPortable: распакуйте приложение в папку с правом записи. В macOS используйте maket-portable.command из архива.`,
    );
  await shutdown(1);
}
function secureWindow(url) {
  const w = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 850,
    minHeight: 600,
    title: 'maket',
    backgroundColor: '#f5f5f7',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      session: localSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  w.webContents.on('will-navigate', (event, destination) => {
    if (new URL(destination).origin !== runtime.origin) event.preventDefault();
  });
  w.webContents.on('will-attach-webview', (event) => event.preventDefault());
  w.webContents.setWindowOpenHandler(({ url: destination }) => {
    if (new URL(destination).origin === runtime.origin) secureWindow(destination);
    return { action: 'deny' };
  });
  w.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(w, {
      type: 'question',
      buttons: ['Остаться', 'Закрыть без сохранения'],
      defaultId: 0,
      cancelId: 0,
      title: 'Несохранённые изменения',
      message: 'На диаграмме есть несохранённые изменения.',
    });
    if (choice === 1) event.preventDefault();
  });
  w.once('ready-to-show', () => w.show());
  w.loadURL(url).catch(failed);
  return w;
}
function isLocal(value) {
  try {
    return new URL(value).origin === runtime.origin;
  } catch {
    return false;
  }
}
async function launch() {
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true, mode: 0o700 });
  const logFile = path.join(dataDir, 'logs', 'desktop.log');
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2_000_000)
    fs.renameSync(logFile, `${logFile}.previous`);
  const log = fs.createWriteStream(logFile, { flags: 'a', mode: 0o600 });
  log.on('error', () => {});
  const splash = new BrowserWindow({
    width: 480,
    height: 250,
    resizable: false,
    title: 'maket',
    backgroundColor: '#f5f5f7',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  splash.setMenu(null);
  await splash.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        '<!doctype html><html lang="ru"><title>maket</title><body style="font-family:system-ui;text-align:center;padding:40px;background:#f5f5f7;color:#1d1d1f"><h1 style="color:#007aff">maket.</h1><p>Открываем локальное пространство…</p><small>При первом запуске готовим базу данных</small></body></html>',
      ),
  );
  starting = startRuntime({
    dataDir,
    serverDir: path.join(resources, 'server'),
    version: app.getVersion(),
    log: (message) => log.write(`${new Date().toISOString()} ${message}\n`),
    onFailure: (error) => {
      if (!stopping) failed(error);
    },
  });
  runtime = await starting;
  if (stopping) return;
  localSession = session.fromPartition('persist:maket-local');
  localSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: new URL(details.url).origin !== runtime.origin }),
  );
  localSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (new URL(details.url).origin === runtime.origin) headers['X-Maket-Desktop'] = runtime.token;
    callback({ requestHeaders: headers });
  });
  localSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(isLocal(contents.getURL()) && permission === 'clipboard-sanitized-write'),
  );
  localSession.setPermissionCheckHandler(
    (contents, permission, origin) => isLocal(origin) && permission === 'clipboard-sanitized-write',
  );
  localSession.on('will-download', (_event, item) =>
    item.setSaveDialogOptions({
      title: 'Сохранить файл',
      defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())),
    }),
  );
  await localSession.cookies.set({
    url: runtime.origin,
    name: 'maket_session',
    value: runtime.sessionToken,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: 'maket',
              submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
            },
          ]
        : []),
      {
        label: 'Файл',
        submenu: [
          { label: 'Открыть папку данных', click: () => shell.openPath(dataDir) },
          {
            label: 'Скопировать адрес MCP',
            click: () => clipboard.writeText(`${runtime.origin}/api/mcp`),
          },
          { type: 'separator' },
          { role: 'close' },
          ...(process.platform !== 'darwin' ? [{ role: 'quit' }] : []),
        ],
      },
      {
        label: 'Правка',
        // Renderer bindings handle keyboard commands; Chromium keeps native text editing.
        submenu: [
          { role: 'undo', accelerator: '' },
          { role: 'redo', accelerator: '' },
          { type: 'separator' },
          { role: 'cut', accelerator: '' },
          { role: 'copy', accelerator: '' },
          { role: 'paste', accelerator: '' },
          { role: 'selectAll', accelerator: '' },
        ],
      },
      {
        label: 'Вид',
        submenu: [
          { role: 'reload' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Справка',
        submenu: [
          { label: 'Вики maket', click: () => secureWindow(`${runtime.origin}/wiki`) },
          {
            label: 'Новые версии в GitHub',
            click: () => shell.openExternal('https://github.com/DoshikKing/maket/releases'),
          },
          {
            label: `maket ${app.getVersion()} · ${portable ? 'Portable' : 'Desktop'}`,
            enabled: false,
          },
        ],
      },
    ]),
  );
  window = secureWindow(`${runtime.origin}/solutions`);
  splash.destroy();
}
