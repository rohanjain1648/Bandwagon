import { createSql } from '../src/db/pool';
import { migrate } from '../src/db/migrate';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/bandwagon_test';

export default async function setup() {
  process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
  const sql = createSql(TEST_DATABASE_URL, { max: 1 });
  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await migrate(sql);
  } finally {
    await sql.end();
  }
}
