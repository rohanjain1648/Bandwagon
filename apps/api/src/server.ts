import cluster from 'node:cluster';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createSql } from './db/pool';
import { migrate } from './db/migrate';
import { cleanupIdempotencyKeys } from './lib/command';
import { cleanupRateLimits } from './lib/rateLimit';
import { seedIfEmpty } from './seed/seed';

/**
 * WEB_CONCURRENCY=N forks N workers sharing the port. Each worker has its own
 * pool and its own LISTEN connection, so SSE fan-out works unchanged: every
 * commit reaches every worker. Correctness never depends on which worker you hit.
 */
const config = loadConfig();
const workers = Math.max(1, Number(process.env.WEB_CONCURRENCY ?? 1));

async function prepareDatabase() {
  const bootSql = createSql(config.databaseUrl, { max: 2, prepare: config.pgPrepare, applicationName: 'bandwagon-boot' });
  try {
    const applied = await migrate(bootSql);
    if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
    if (config.seedIfEmpty) await seedIfEmpty(bootSql, console.log);
  } finally {
    await bootSql.end();
  }
}

async function startWorker(runJanitor: boolean) {
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: config.host });

  if (runJanitor) {
    const janitor = setInterval(
      () => {
        void cleanupIdempotencyKeys(app.sql).catch((err) => app.log.warn({ err }, 'idempotency cleanup failed'));
        void cleanupRateLimits(app.sql).catch((err) => app.log.warn({ err }, 'rate limit cleanup failed'));
      },
      10 * 60 * 1000,
    );
    janitor.unref();
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (workers > 1 && cluster.isPrimary) {
  await prepareDatabase();
  let stopping = false;
  for (let i = 0; i < workers; i++) cluster.fork({ BW_WORKER_INDEX: String(i) });
  cluster.on('exit', (worker, code, signal) => {
    if (stopping) return;
    console.error(`worker ${worker.process.pid} exited (${signal ?? code}); restarting`);
    cluster.fork({ BW_WORKER_INDEX: '1' });
  });
  const stop = (signal: NodeJS.Signals) => {
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill(signal);
    setTimeout(() => process.exit(0), 11_000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
} else if (cluster.isWorker) {
  await startWorker(process.env.BW_WORKER_INDEX === '0');
} else {
  await prepareDatabase();
  await startWorker(true);
}
