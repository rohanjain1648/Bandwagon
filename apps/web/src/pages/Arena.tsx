import type { RaceResult } from '@bw/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShell } from '../components/Shell';
import { Button, ErrorNote, Panel } from '../components/ui';
import { api, errorMessage, newKey } from '../lib/api';
import styles from './pages.module.css';
import arena from './arena.module.css';

/**
 * Race Arena: fifty bots fire fifty concurrent join transactions at one open seat,
 * through the same code path as the Join button. The result is replayed here in
 * the order the server resolved them.
 */
export function ArenaPage() {
  const { hackathon } = useShell();
  const [result, setResult] = useState<RaceResult | null>(null);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!result) return;
    setShown(0);
    const step = Math.max(12, 900 / result.timeline.length);
    const timer = setInterval(() => setShown((n) => (n >= result.timeline.length ? n : n + 1)), step);
    return () => clearInterval(timer);
  }, [result]);

  async function run() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api.post<RaceResult>('/demo/race', { hackathonId: hackathon.id, attempts: 50 }, newKey()));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const done = result && shown >= result.timeline.length;
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <header>
        <h1 className={styles.title}>Race arena</h1>
        <p className={styles.lede}>
          Fifty people press Join on a team with one seat left, at the same instant. Each attempt is its own database transaction on its own connection, the same code path as the real Join button. Exactly one should get the seat.
        </p>
      </header>
      <Panel
        title={result ? result.teamName : 'One seat, fifty hands'}
        action={
          <Button size="lg" variant="foil" busy={busy} onClick={() => void run()}>
            {result ? 'Race again' : 'Start the race'}
          </Button>
        }
      >
        {error && <ErrorNote>{error}</ErrorNote>}
        <ol className={arena.field} aria-label="Fifty join attempts">
          {Array.from({ length: 50 }, (_, i) => {
            const t = result?.timeline[i];
            const state = !t || i >= shown ? (busy ? 'racing' : 'idle') : t.outcome === 'WON' ? 'won' : 'lost';
            return (
              <li key={i} className={arena.token} data-state={state} title={t && i < shown ? `${t.bot}: ${t.outcome === 'WON' ? 'got the seat' : 'turned away'} at ${t.ms} ms` : undefined}>
                <span className="visually-hidden">{t && i < shown ? `${t.bot} ${t.outcome === 'WON' ? 'got the seat' : 'was turned away'}` : 'waiting'}</span>
              </li>
            );
          })}
        </ol>
        <div aria-live="polite">
          {done && result && (
            <dl className={arena.verdict}>
              <div>
                <dt>Got the seat</dt>
                <dd>{result.winners}</dd>
              </div>
              <div>
                <dt>Turned away (team full)</dt>
                <dd>{result.outcomes.TEAM_FULL ?? 0}</dd>
              </div>
              <div>
                <dt>Invariant violations</dt>
                <dd>{result.invariantViolations}</dd>
              </div>
              <div>
                <dt>All 50 resolved in</dt>
                <dd>{result.durationMs} ms</dd>
              </div>
            </dl>
          )}
          {done && result && (
            <p className={styles.muted} style={{ marginTop: 'var(--s-3)' }}>
              {result.winnerName} got the last seat. The team showed up on <Link to={`/h/${hackathon.slug}`}>the board</Link> for everyone and folds itself in a few seconds so the bots can race again.
            </p>
          )}
        </div>
      </Panel>
      <Panel title="Why exactly one">
        <p className={styles.muted}>
          Every join locks the team’s row first, then re-reads the seat count under the lock. The other 49 queue behind it and find the team full. A database CHECK constraint on the seat count is the backstop: even buggy code could not overfill a team.
        </p>
      </Panel>
    </div>
  );
}
