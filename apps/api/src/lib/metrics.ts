import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'bw_node_' });
  return {
    registry,
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5],
      registers: [registry],
    }),
    joinAttempts: new Counter({
      name: 'bw_join_attempts_total',
      help: 'Seat claims by path and outcome',
      labelNames: ['via', 'outcome'],
      registers: [registry],
    }),
    txRetries: new Counter({
      name: 'bw_tx_retries_total',
      help: 'Transactions retried after deadlock/serialization failure',
      labelNames: ['code'],
      registers: [registry],
    }),
    idempotentReplays: new Counter({
      name: 'bw_idempotent_replays_total',
      help: 'Requests answered from a stored idempotent response',
      registers: [registry],
    }),
    sseClients: new Gauge({ name: 'bw_sse_clients', help: 'Connected SSE clients', registers: [registry] }),
    sseFrames: new Counter({ name: 'bw_sse_frames_total', help: 'SSE frames written', labelNames: ['event'], registers: [registry] }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
