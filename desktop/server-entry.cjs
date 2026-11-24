const path = require('node:path');
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const directory = path.dirname(path.resolve(process.argv[2]));
const config = require(path.join(directory, '.next-desktop', 'desktop-config.json'));
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
const next = require(require.resolve('next', { paths: [directory] }));
const secret = process.env.MAKET_DESKTOP_TOKEN;
if (!secret) throw new Error('Desktop runtime secret is required');
const expected = Buffer.from(secret);
const application = next({ dev: false, dir: directory, conf: config });
const handle = application.getRequestHandler();
// IPC closes even if the desktop process is killed. Do not leave an orphan HTTP server.
process.once('disconnect', () => process.exit(0));
application
  .prepare()
  .then(() => {
    const server = http.createServer((request, response) => {
      const value = request.headers['x-maket-desktop'];
      const supplied = typeof value === 'string' ? Buffer.from(value) : Buffer.alloc(0);
      let pathname;
      try {
        pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      } catch {
        response.writeHead(400);
        return response.end();
      }
      // MCP independently authenticates scoped Bearer keys and never accepts cookie authentication.
      if (
        pathname !== '/api/mcp' &&
        (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      ) {
        response.writeHead(403, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        });
        return response.end('Open this address in the maket desktop application');
      }
      handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    server.once('error', (error) => {
      console.error(error.message);
      process.exit(1);
    });
    server.listen(Number(process.env.PORT), '127.0.0.1');
    process.once('SIGTERM', () => {
      server.close(() => {
        application.close().finally(() => process.exit(0));
      });
    });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
