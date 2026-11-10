import 'fastify';
import type { Config } from './config';
import type { Sql } from './db/pool';
import type { Metrics } from './lib/metrics';
import type { EventHub } from './modules/events/hub';

declare module 'fastify' {
  interface FastifyInstance {
    sql: Sql;
    config: Config;
    metrics: Metrics;
    hub: EventHub;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    auth: { id: string; role: 'participant' | 'organizer' };
  }
}
