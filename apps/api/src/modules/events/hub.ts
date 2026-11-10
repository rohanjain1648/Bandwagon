import type { BoardFrame, PersonalEvent } from '@bw/shared';
import type { ServerResponse } from 'node:http';
import type { FastifyBaseLogger } from 'fastify';
import type { Sql } from '../../db/pool';
import type { Metrics } from '../../lib/metrics';
import { EVENTS_CHANNEL, type DbEvent } from '../../lib/notify';
import { getTeamSnapshots } from '../teams/queries';
import { getPeopleSnapshots } from '../board/queries';

interface Client {
  userId: string;
  res: ServerResponse;
}

interface Dirty {
  teams: Set<string>;
  removed: Set<string>;
  people: Set<string>;
  peopleRemoved: Set<string>;
}

export interface HubOptions {
  coalesceMs: number;
  heartbeatMs: number;
  metrics: Metrics;
  log: FastifyBaseLogger;
}

const MAX_BUFFERED = 1024 * 1024;

/**
 * Per-instance fan-out. Each instance LISTENs on Postgres; commits anywhere
 * reach every instance's clients, so no sticky sessions or Redis are needed.
 * Board changes are coalesced per hackathon every `coalesceMs`: a burst of
 * 200 joins costs each client a handful of frames, not 200.
 */
export class EventHub {
  private readonly clients = new Map<string, Set<Client>>();
  private readonly dirty = new Map<string, Dirty>();
  private flushTimer?: NodeJS.Timeout;
  private beatTimer?: NodeJS.Timeout;
  private unlisten?: () => Promise<void>;
  private flushing = false;
  private listenedOnce = false;

  constructor(
    private readonly sql: Sql,
    private readonly listenSql: Sql | null,
    private readonly opts: HubOptions,
  ) {}

  async start(): Promise<void> {
    if (this.listenSql) {
      const sub = await this.listenSql.listen(
        EVENTS_CHANNEL,
        (payload) => this.onNotify(payload),
        () => {
          // Fired on first listen and on every reconnect. Notifications sent while
          // we were disconnected are gone, so tell clients to resync.
          if (this.listenedOnce) this.broadcastAll('resync', { reason: 'listener reconnected' });
          this.listenedOnce = true;
        },
      );
      this.unlisten = sub.unlisten;
    }
    this.flushTimer = setInterval(() => void this.flush(), this.opts.coalesceMs);
    this.beatTimer = setInterval(() => this.heartbeat(), this.opts.heartbeatMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.flushTimer);
    clearInterval(this.beatTimer);
    await this.unlisten?.().catch(() => {});
    for (const set of this.clients.values()) {
      for (const c of set) {
        c.res.write('event: bye\ndata: {}\n\n');
        c.res.end();
      }
    }
    this.clients.clear();
  }

  clientCount(): number {
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  attach(hackathonId: string, userId: string, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    const client: Client = { userId, res };
    let set = this.clients.get(hackathonId);
    if (!set) {
      set = new Set();
      this.clients.set(hackathonId, set);
    }
    set.add(client);
    this.opts.metrics.sseClients.inc();
    this.write(client, 'hello', { at: new Date().toISOString(), hackathonId });
    res.on('close', () => {
      set!.delete(client);
      if (set!.size === 0) this.clients.delete(hackathonId);
      this.opts.metrics.sseClients.dec();
    });
  }

  /** Exposed for tests and the in-process path; normally fed by LISTEN. */
  onNotify(payload: string): void {
    let evt: DbEvent;
    try {
      evt = JSON.parse(payload) as DbEvent;
    } catch {
      return;
    }
    const set = this.clients.get(evt.h);
    if (!set) return; // nobody here is watching this hackathon
    for (const p of evt.u ?? []) {
      for (const c of set) if (c.userId === p.to) this.write(c, 'personal', p.e satisfies PersonalEvent);
    }
    if (!evt.t && !evt.r && !evt.p && !evt.pr) return;
    let d = this.dirty.get(evt.h);
    if (!d) {
      d = { teams: new Set(), removed: new Set(), people: new Set(), peopleRemoved: new Set() };
      this.dirty.set(evt.h, d);
    }
    for (const id of evt.t ?? []) d.teams.add(id);
    for (const id of evt.r ?? []) {
      d.removed.add(id);
      d.teams.delete(id);
    }
    for (const id of evt.p ?? []) {
      d.people.add(id);
      d.peopleRemoved.delete(id);
    }
    for (const id of evt.pr ?? []) {
      d.peopleRemoved.add(id);
      d.people.delete(id);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.dirty.size === 0) return;
    this.flushing = true;
    const batch = [...this.dirty.entries()];
    this.dirty.clear();
    try {
      for (const [hackathonId, d] of batch) {
        const set = this.clients.get(hackathonId);
        if (!set || set.size === 0) continue;
        const teams = await getTeamSnapshots(this.sql, [...d.teams]);
        const found = new Set(teams.map((t) => t.id));
        const removed = [...d.removed, ...[...d.teams].filter((id) => !found.has(id))];
        const people = await getPeopleSnapshots(this.sql, hackathonId, [...d.people]);
        const foundPeople = new Set(people.map((p) => p.id));
        const peopleRemoved = [...d.peopleRemoved, ...[...d.people].filter((id) => !foundPeople.has(id))];
        const frame: BoardFrame = { teams, removed, people, peopleRemoved, at: new Date().toISOString() };
        const data = JSON.stringify(frame);
        for (const c of set) this.writeRaw(c, 'board', data);
      }
    } catch (err) {
      this.opts.log.error({ err }, 'sse flush failed; asking clients to resync');
      this.broadcastAll('resync', { reason: 'flush failed' });
    } finally {
      this.flushing = false;
    }
  }

  private heartbeat(): void {
    for (const set of this.clients.values()) for (const c of set) c.res.write(`: ping\n\n`);
  }

  private broadcastAll(event: string, data: unknown): void {
    for (const set of this.clients.values()) for (const c of set) this.write(c, event, data);
  }

  private write(c: Client, event: string, data: unknown): void {
    this.writeRaw(c, event, JSON.stringify(data));
  }

  private writeRaw(c: Client, event: string, data: string): void {
    if (c.res.writableLength > MAX_BUFFERED) {
      // A client that can't keep up is dropped; it reconnects and resyncs.
      c.res.destroy();
      return;
    }
    c.res.write(`event: ${event}\ndata: ${data}\n\n`);
    this.opts.metrics.sseFrames.inc({ event });
  }
}
