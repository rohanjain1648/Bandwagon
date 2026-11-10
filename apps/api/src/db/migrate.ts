import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './pool';

const MIGRATION_LOCK = 727001;

export function findMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(here, '../../migrations'), // src/db → apps/api/migrations
    resolve(here, '../migrations'), // dist → apps/api/migrations
    resolve(process.cwd(), 'migrations'),
    resolve(process.cwd(), 'apps/api/migrations'),
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(join(p, '001_init.sql')));
  if (!found) throw new Error(`migrations directory not found (tried ${candidates.join(', ')})`);
  return found;
}

/** Apply pending migrations in order, each in its own transaction, under an advisory lock. */
export async function migrate(sql: Sql, dir = findMigrationsDir()): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
  });
  return applied;
}
