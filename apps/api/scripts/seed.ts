/**
 * Seed demo data.
 *   pnpm seed                       # 10,000 users, 2,000 teams (fails if data exists)
 *   pnpm seed --reset               # wipe the schema first
 *   pnpm seed --users 500 --teams 100
 */
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { createSql } from '../src/db/pool';
import { runSeed } from '../src/seed/seed';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const config = loadConfig();
const sql = createSql(config.databaseUrl, { max: 2, prepare: config.pgPrepare, applicationName: 'bandwagon-seed' });
try {
  if (args.includes('--reset')) {
    console.log('resetting schema…');
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  }
  await migrate(sql);
  const [{ n }] = (await sql`SELECT count(*)::int AS n FROM hackathons`) as unknown as [{ n: number }];
  if (n > 0) {
    console.error('database already has data; pass --reset to start over');
    process.exit(1);
  }
  const result = await runSeed(sql, { users: flag('users', 10_000), teams: flag('teams', 2_000), log: (m) => console.log(m) });
  console.log(JSON.stringify(result));
} finally {
  await sql.end();
}
