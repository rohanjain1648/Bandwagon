import type { PersonalEvent } from '@bw/shared';
import type { Db } from '../db/pool';

export const EVENTS_CHANNEL = 'bw_events';

/** What changed, by id. The hub loads current state after commit; payloads stay tiny. */
export interface DbEvent {
  h: string;
  /** teams whose snapshot changed */
  t?: string[];
  /** teams that no longer exist */
  r?: string[];
  /** people whose board card changed (solo + looking) */
  p?: string[];
  /** people who left the people board (joined a team or stopped looking) */
  pr?: string[];
  /** personal events, delivered only to that user's connections */
  u?: Array<{ to: string; e: PersonalEvent }>;
}

const MAX_PAYLOAD = 7000; // Postgres limit is 8000 bytes

/**
 * pg_notify inside the command's transaction: Postgres delivers it only if the
 * transaction commits, so a rolled-back race produces no event at all.
 */
export async function notify(db: Db, evt: DbEvent): Promise<void> {
  const payload = JSON.stringify(evt);
  if (payload.length <= MAX_PAYLOAD) {
    await db`SELECT pg_notify(${EVENTS_CHANNEL}, ${payload})`;
    return;
  }
  // Large fan-outs (a team deleted with many pending requesters): split personal events.
  const { u = [], ...rest } = evt;
  await db`SELECT pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(rest)})`;
  for (let i = 0; i < u.length; i += 20) {
    await db`SELECT pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify({ h: evt.h, u: u.slice(i, i + 20) })})`;
  }
}
