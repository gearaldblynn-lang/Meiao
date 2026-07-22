const getDefaultReadySender = () => (
  typeof process.send === 'function' ? process.send.bind(process) : null
);

export const getProcessReleaseIdentity = ({
  env = process.env,
  pid = process.pid,
  startedAt = Date.now(),
} = {}) => ({
  id: String(env.MEIAO_RELEASE_ID || '').trim() || 'unversioned',
  pid,
  startedAt,
});

export const listenAndNotifyReady = ({
  server,
  port,
  host,
  send = getDefaultReadySender(),
}) => new Promise((resolve, reject) => {
  const onError = (error) => {
    server.off?.('error', onError);
    reject(error);
  };
  const onListening = () => {
    server.off?.('error', onError);
    send?.('ready');
    resolve();
  };

  server.once?.('error', onError);
  if (host) {
    server.listen(port, host, onListening);
  } else {
    server.listen(port, onListening);
  }
});

const closeHttpServer = (server) => new Promise((resolve, reject) => {
  if (!server?.close) {
    resolve();
    return;
  }
  server.close((error) => {
    if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
      reject(error);
      return;
    }
    server.closeIdleConnections?.();
    resolve();
  });
});

export const createGracefulShutdown = ({
  server,
  stopWorkers = [],
  clearTimers = [],
  shutdownTemporal,
  closePools = [],
}) => {
  let shutdownPromise = null;
  return () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      for (const stopWorker of stopWorkers) await stopWorker?.();
      for (const clearTimer of clearTimers) await clearTimer?.();
      await shutdownTemporal?.();
      await closeHttpServer(server);
      for (const closePool of closePools) await closePool?.();
    })();
    return shutdownPromise;
  };
};

export const registerProcessShutdown = ({
  shutdown,
  processRef = process,
  logger = console,
}) => {
  let handlingSignal = false;
  const handleSignal = (signal) => {
    if (handlingSignal) return;
    handlingSignal = true;
    void shutdown()
      .then(() => processRef.exit(0))
      .catch((error) => {
        logger.error(`Graceful shutdown failed after ${signal}:`, error);
        processRef.exit(1);
      });
  };
  processRef.once('SIGINT', () => handleSignal('SIGINT'));
  processRef.once('SIGTERM', () => handleSignal('SIGTERM'));
};
