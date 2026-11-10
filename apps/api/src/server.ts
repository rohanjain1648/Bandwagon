import { buildApp } from './app';
import { loadConfig } from './config';
import { createSql } from './db/pool';
import { migrate } from './db/migrate';
import { cleanupIdempotencyKeys } from './lib/command';
import { cleanupRateLimits } from './lib/rateLimit';
import { seedIfEmpty } from './seed/seed';

const config = loadConfig();

const bootSql = createSql(config.databaseUrl, { max: 2, prepare: config.pgPrepare, applicationName: 'bandwagon-boot' });
const applied = await migrate(bootSql);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
if (config.seedIfEmpty) await seedIfEmpty(bootSql, console.log);
await bootSql.end();

const app = await buildApp(config);
await app.listen({ port: config.port, host: config.host });

const janitor = setInterval(
  () => {
    void cleanupIdempotencyKeys(app.sql).catch((err) => app.log.warn({ err }, 'idempotency cleanup failed'));
    void cleanupRateLimits(app.sql).catch((err) => app.log.warn({ err }, 'rate limit cleanup failed'));
  },
  10 * 60 * 1000,
);
janitor.unref();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await app.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
