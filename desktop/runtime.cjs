const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomBytes, randomUUID, createHash, scryptSync } = require('node:crypto');
const { Client } = require('pg');
const run = promisify(execFile);
function startDetached(file, args) {
  return new Promise((resolve, reject) => {
    // pg_ctl's Windows CMD child lives as long as PostgreSQL. Inherited stdout
    // pipes keep execFile's callback pending even after pg_ctl exits successfully.
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PostgreSQL startup timed out'));
    }, 35000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`pg_ctl exited ${code}`));
    });
  });
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const exists = async (file) => !!(await fs.stat(file).catch(() => null));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function childEnvironment() {
  // Do not inherit a server installation's database, mail, auth, Node hooks or dotenv configuration.
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(path|systemroot|windir|comspec|pathext|temp|tmp|tmpdir|home|userprofile|appdata|localappdata|lang|lc_.*|fontconfig_.*|xdg_.*)$/i.test(
        key,
      ),
    ),
  );
}
function portableDirectory({
  resourcesPath,
  executable,
  env = process.env,
  platform = process.platform,
  portable,
}) {
  if (env.MAKET_PORTABLE_DIR) return path.resolve(env.MAKET_PORTABLE_DIR);
  if (env.PORTABLE_EXECUTABLE_DIR) return path.resolve(env.PORTABLE_EXECUTABLE_DIR);
  if (!portable) return null;
  if (env.APPIMAGE) return path.dirname(path.resolve(env.APPIMAGE));
  return platform === 'darwin' ? path.resolve(resourcesPath, '../../..') : path.dirname(executable);
}
async function readSettings(dataDir) {
  const filename = path.join(dataDir, 'desktop.json');
  if (await exists(filename)) {
    const value = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (
      value.version !== 1 ||
      (value.appVersion !== null && !/^\d+\.\d+\.\d+$/.test(value.appVersion)) ||
      !/^[a-f0-9]{64}$/.test(value.password) ||
      !/^[a-f0-9-]{36}$/.test(value.userId) ||
      !Number.isInteger(value.httpPort) ||
      value.httpPort < 1024 ||
      value.httpPort > 65535
    )
      throw new Error(
        'Некорректный desktop.json. Восстановите его из резервной копии; существующая база не изменена.',
      );
    return value;
  }
  if (await exists(path.join(dataDir, 'postgres', 'PG_VERSION')))
    throw new Error(
      'Не найден desktop.json для существующей базы. Восстановите файл из резервной копии.',
    );
  const value = {
    version: 1,
    password: randomBytes(32).toString('hex'),
    userId: randomUUID(),
    httpPort: await freePort(),
    appVersion: null,
  };
  await fs.writeFile(filename, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  return value;
}
async function writeSettings(dataDir, value) {
  const temporary = path.join(dataDir, 'desktop.json.tmp');
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temporary, path.join(dataDir, 'desktop.json'));
}
async function startRuntime({
  dataDir,
  serverDir,
  version,
  nodeExecutable = process.execPath,
  log = () => {},
  onFailure = () => {},
}) {
  if (process.getuid?.() === 0)
    throw new Error('Запускайте maket от обычного пользователя, без sudo/root.');
  process.umask(0o077);
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const settings = await readSettings(dataDir);
  const dbDir = path.join(dataDir, 'postgres');
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const platformName = process.platform === 'win32' ? 'windows' : process.platform;
  const binaries = await import(`@embedded-postgres/${platformName}-${process.arch}`);
  const token = randomBytes(32).toString('hex'),
    startupId = randomBytes(16).toString('hex');
  let pgPort = await freePort();
  while (pgPort === settings.httpPort) pgPort = await freePort();
  const pgConfig = {
    host: '127.0.0.1',
    port: pgPort,
    user: 'maket',
    password: settings.password,
    database: 'postgres',
    connectionTimeoutMillis: 5000,
  };
  let databaseMessages = '';
  const database = new EmbeddedPostgres({
    databaseDir: dbDir,
    user: 'maket',
    password: settings.password,
    port: pgPort,
    persistent: true,
    authMethod: 'scram-sha-256',
    initdbFlags: [
      '--encoding=UTF8',
      '--locale-provider=builtin',
      '--builtin-locale=C.UTF-8',
      '--locale=C',
    ],
    postgresFlags: ['-h', '127.0.0.1', '-c', 'unix_socket_directories='],
    onLog: (message) => {
      databaseMessages = (databaseMessages + message).slice(-2000);
      log(message);
    },
    onError: (value) => log(String(value)),
  });
  let ready = false;
  let detachedDatabase = false;
  let server,
    stopping = false,
    sessionToken,
    refresh,
    postgresMonitor;
  async function sql(text, values, override) {
    const client = new Client({ ...pgConfig, ...override });
    client.on('error', () => {});
    try {
      await client.connect();
      return await client.query(text, values);
    } finally {
      await client.end().catch(() => {});
    }
  }
  async function stopDatabase() {
    if (detachedDatabase) {
      detachedDatabase = false;
      try {
        await run(binaries.pg_ctl, ['-D', dbDir, 'stop', '-m', 'fast', '-w', '-t', '20'], {
          timeout: 25000,
          windowsHide: true,
        });
      } catch (error) {
        const status = await run(binaries.pg_ctl, ['-D', dbDir, 'status'], {
          windowsHide: true,
        }).catch((e) => e);
        if (status.code !== 3) throw error;
      }
      return;
    }
    if (
      !database.process ||
      database.process.exitCode !== null ||
      database.process.signalCode !== null
    ) {
      database.process = undefined;
      return;
    }
    // pg_ctl also performs a graceful shutdown on Windows; taskkill is only the package's fallback.
    try {
      await run(binaries.pg_ctl, ['-D', dbDir, 'stop', '-m', 'fast', '-w', '-t', '20'], {
        timeout: 25000,
        windowsHide: true,
      });
      database.process = undefined;
    } catch (error) {
      log(`PostgreSQL shutdown: ${error.message}`);
      await database.stop();
    }
  }
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(refresh);
    clearInterval(postgresMonitor);
    if (server && server.pid && server.exitCode === null && server.signalCode === null) {
      const closed = new Promise((resolve) => server.once('exit', resolve));
      server.kill();
      const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(timer);
    }
    if (sessionToken)
      await sql('DELETE FROM "Session" WHERE id=$1', [hash(sessionToken)]).catch(() => {});
    await stopDatabase();
  }
  try {
    const initialized = await exists(path.join(dbDir, 'PG_VERSION'));
    if (initialized) {
      if (
        settings.appVersion &&
        settings.appVersion
          .split('.')
          .map(Number)
          .some(
            (value, i, previous) =>
              value > Number(version.split('.')[i]) &&
              previous.slice(0, i).every((n, j) => n === Number(version.split('.')[j])),
          )
      )
        throw new Error(
          'Эти данные открывались в более новой версии maket. Для возврата используйте резервную копию, а не старую программу с текущей базой.',
        );
      if ((await fs.readFile(path.join(dbDir, 'PG_VERSION'), 'utf8')).trim() !== '17')
        throw new Error(
          'Версия локальной базы отличается от PostgreSQL 17. Требуется перенос данных; база не изменена.',
        );
      // Recover only an authenticated orphan belonging to this exact data directory.
      if (await exists(path.join(dbDir, 'postmaster.pid'))) {
        const port = Number(
          (await fs.readFile(path.join(dbDir, 'postmaster.pid'), 'utf8')).split('\n')[3],
        );
        const running = await sql('SHOW data_directory', undefined, {
          port,
          connectionTimeoutMillis: 1500,
        }).catch(() => null);
        if (!running) {
          const pid = Number(
            (await fs.readFile(path.join(dbDir, 'postmaster.pid'), 'utf8')).split('\n')[0],
          );
          let alive = false;
          try {
            process.kill(pid, 0);
            alive = true;
          } catch (error) {
            if (error.code !== 'ESRCH') alive = true;
          }
          if (alive)
            throw new Error(
              'Локальная база уже запущена, но не отвечает с сохранёнными реквизитами. Закройте другие экземпляры maket; база не изменена.',
            );
        }
        if (running) {
          if ((await fs.realpath(running.rows[0].data_directory)) !== (await fs.realpath(dbDir)))
            throw new Error('Порт занят другой базой. Посторонний процесс не остановлен.');
          await run(binaries.pg_ctl, ['-D', dbDir, 'stop', '-m', 'fast', '-w', '-t', '20'], {
            timeout: 25000,
            windowsHide: true,
          });
        }
      }
      if (settings.appVersion && settings.appVersion !== version) {
        const backup = path.join(
          dataDir,
          'backups',
          `${new Date().toISOString().replace(/[:.]/g, '-')}-${settings.appVersion}`,
        );
        await fs.mkdir(backup, { recursive: true, mode: 0o700 });
        await fs.cp(dbDir, path.join(backup, 'postgres'), { recursive: true });
        await fs.copyFile(path.join(dataDir, 'desktop.json'), path.join(backup, 'desktop.json'));
        log('Created pre-upgrade database backup');
      }
    } else await database.initialise();
    try {
      if (process.platform === 'win32') {
        // pg_ctl strips administrative privileges before starting PostgreSQL on Windows.
        // Directly spawning postgres.exe fails under an elevated account (including hosted CI).
        await fs.mkdir(path.join(dataDir, 'logs'), { recursive: true, mode: 0o700 });
        detachedDatabase = true;
        await startDetached(binaries.pg_ctl, [
          '-D',
          dbDir,
          '-l',
          path.join(dataDir, 'logs', 'postgres.log'),
          '-o',
          `-h 127.0.0.1 -p ${pgPort} -c unix_socket_directories=`,
          'start',
          '-w',
          '-t',
          '30',
        ]);
        const pid = Number(
          (await fs.readFile(path.join(dbDir, 'postmaster.pid'), 'utf8')).split('\n')[0],
        );
        postgresMonitor = setInterval(() => {
          if (!ready || stopping) return;
          try {
            process.kill(pid, 0);
          } catch (error) {
            if (error.code === 'ESRCH')
              onFailure(
                new Error('Локальная база неожиданно остановилась. Перезапустите приложение.'),
              );
          }
        }, 2000);
        postgresMonitor.unref();
      } else {
        await database.start();
        database.process.once('exit', () => {
          if (ready && !stopping)
            onFailure(
              new Error('Локальная база неожиданно остановилась. Перезапустите приложение.'),
            );
        });
      }
    } catch {
      const windowsLog =
        process.platform === 'win32'
          ? await fs.readFile(path.join(dataDir, 'logs', 'postgres.log'), 'utf8').catch(() => '')
          : '';
      throw new Error(
        `Не удалось запустить локальный PostgreSQL.\n${(windowsLog || databaseMessages).slice(-2000)}`,
      );
    }
    // A successful pg_ctl exit can precede the first accepted connection on Windows.
    // Check the database itself before migrations or profile creation, including crash recovery.
    const databaseDeadline = Date.now() + 30000;
    while (true) {
      try {
        await sql('SELECT 1');
        break;
      } catch (error) {
        if (Date.now() > databaseDeadline)
          throw new Error(`Локальная база не готова: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    const connection = new URL(
      `postgresql://maket:${settings.password}@127.0.0.1:${pgPort}/postgres`,
    );
    connection.searchParams.set('schema', 'public');
    const origin = `http://127.0.0.1:${settings.httpPort}`;
    const env = {
      ...childEnvironment(),
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      DATABASE_URL: connection.href,
      POSTGRES_SCHEMA: 'public',
      APP_URL: '',
      HOSTNAME: '127.0.0.1',
      PORT: String(settings.httpPort),
      PUBLIC_ORIGIN: origin,
      MAKET_DESKTOP_TOKEN: token,
      MAKET_STARTUP_ID: startupId,
      MAKET_INVITE_CODE: randomBytes(24).toString('base64url'),
    };
    const migration = await run(nodeExecutable, [path.join(serverDir, 'scripts', 'migrate.mjs')], {
      cwd: serverDir,
      env,
      timeout: 120000,
      windowsHide: true,
    });
    log(migration.stdout);
    const salt = randomBytes(16).toString('hex'),
      password = `${salt}:${scryptSync(randomBytes(32).toString('hex'), salt, 64).toString('hex')}`;
    await sql(
      'INSERT INTO "User" (id,email,name,"passwordHash","emailVerified") VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING',
      [settings.userId, 'local@maket.desktop', 'Локальный профиль', password],
    );
    sessionToken = randomBytes(32).toString('hex');
    await sql('DELETE FROM "Session" WHERE "userId"=$1', [settings.userId]);
    await sql(
      'INSERT INTO "Session" (id,"userId","expiresAt") VALUES ($1,$2,NOW()+INTERVAL \'7 days\')',
      [hash(sessionToken), settings.userId],
    );
    server = spawn(
      nodeExecutable,
      [path.join(__dirname, 'server-entry.cjs'), path.join(serverDir, 'server.js')],
      {
        cwd: serverDir,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    let serverError;
    server.once('error', (error) => {
      serverError = error;
    });
    server.stdout.on('data', (chunk) => log(chunk.toString()));
    server.stderr.on('data', (chunk) => log(chunk.toString()));
    server.once('exit', (code) => {
      if (ready && !stopping)
        onFailure(
          new Error(`Локальный сервер остановился (код ${code}). Перезапустите приложение.`),
        );
    });
    const deadline = Date.now() + 60000;
    while (true) {
      if (serverError) throw serverError;
      if (server.exitCode !== null || server.signalCode !== null || Date.now() > deadline)
        throw new Error(
          'Не удалось запустить локальный сервер. Проверьте журнал запуска и доступность локального порта.',
        );
      try {
        const response = await fetch(`${origin}/api/health`, {
          headers: { 'X-Maket-Desktop': token, 'X-Maket-Startup': startupId },
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok && response.headers.get('X-Maket-Startup') === startupId) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    ready = true;
    settings.appVersion = version;
    await writeSettings(dataDir, settings);
    refresh = setInterval(() => {
      sql('UPDATE "Session" SET "expiresAt"=NOW()+INTERVAL \'7 days\' WHERE id=$1', [
        hash(sessionToken),
      ]).catch(() => {});
    }, 3600000);
    refresh.unref();
    return { origin, token, sessionToken, dataDir, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
module.exports = { startRuntime, portableDirectory, childEnvironment };
