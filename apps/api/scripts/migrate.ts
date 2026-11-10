import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { createSql } from '../src/db/pool';

const config = loadConfig();
const sql = createSql(config.databaseUrl, { max: 1, prepare: config.pgPrepare });
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
} finally {
  await sql.end();
}
