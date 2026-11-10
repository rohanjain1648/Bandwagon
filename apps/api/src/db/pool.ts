import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
/** Anything that can run a query: the pool or an open transaction. */
export type Db = Sql | Tx;

export interface SqlOptions {
  max?: number;
  prepare?: boolean;
  applicationName?: string;
}

export function createSql(url: string, opts: SqlOptions = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? true,
    idle_timeout: 30,
    connect_timeout: 15,
    max_lifetime: 60 * 30,
    onnotice: () => {},
    // UTC sessions: timestamps render identically whichever server or DB region serves them.
    connection: { application_name: opts.applicationName ?? 'bandwagon', TimeZone: 'UTC' },
    transform: { undefined: null },
  }) as unknown as Sql;
}
