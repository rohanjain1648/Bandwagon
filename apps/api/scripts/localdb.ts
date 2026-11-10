/**
 * Local Postgres 16 without Docker (native binaries via embedded-postgres).
 * Usage: pnpm localdb   → listens on localhost:54329, databases bandwagon + bandwagon_test.
 * Docker users can ignore this and run `docker compose up -d db` instead.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dataDir = resolve(process.cwd(), process.env.LOCALDB_DIR ?? '../../.localdb/data');
const port = Number(process.env.LOCALDB_PORT ?? 54329);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'max_connections=300', '-c', 'fsync=off', '-c', 'synchronous_commit=off'],
  onLog: () => {},
});

if (!existsSync(resolve(dataDir, 'PG_VERSION'))) {
  await pg.initialise();
}
await pg.start();
for (const db of ['bandwagon', 'bandwagon_test']) {
  try {
    await pg.createDatabase(db);
  } catch {
    // already exists
  }
}
console.log(`localdb ready on postgres://postgres:postgres@localhost:${port}/bandwagon`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
