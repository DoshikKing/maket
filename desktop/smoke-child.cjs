const { startRuntime } = require('./runtime.cjs');
startRuntime({
  dataDir: process.argv[2],
  serverDir: process.argv[3],
  version: require('./package.json').version,
})
  .then((runtime) => {
    process.send({ ready: true });
    process.on('message', async () => {
      await runtime.stop();
      process.exit(0);
    });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
