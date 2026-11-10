import type { MemberSnapshot, RaceResult } from '@bw/shared';
import { SeatSlots } from '../components/SeatSlots';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShell } from '../components/Shell';
import { Button, ErrorNote, Panel } from '../components/ui';
import { api, errorMessage, newKey } from '../lib/api';
import styles from './pages.module.css';
import arena from './arena.module.css';

const HOUSE: MemberSnapshot[] = ['Ada Bot', 'Grace Bot', 'Linus Bot'].map((displayName, i) => ({
  id: `house-${i}`,
  displayName,
  skills: ['typescript'],
  timezone: 'UTC',
  utcOffsetMinutes: 0,
  isLeader: i === 0,
  joinedAt: '',
}));

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
  // The hand: house bots first; the winner is dealt in once the replay finishes (the signature move).
  const houseMembers = result?.team?.members.filter((m) => m.id !== result.winnerId) ?? HOUSE;
  const winner = result?.team?.members.find((m) => m.id === result.winnerId);
  const handMembers = done && winner ? [...houseMembers, winner] : houseMembers;
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
          <Button size="lg" busy={busy} onClick={() => void run()}>
            {result ? 'Race again' : 'Start the race'}
          </Button>
        }
      >
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className={arena.stage}>
          <div className={arena.handCol}>
            <p className={arena.caption}>{done ? 'The hand: the winner was dealt the last seat' : 'The hand: three seats taken, one open'}</p>
            <SeatSlots members={handMembers} maxSize={4} label={done ? '4 of 4 seats taken' : '3 of 4 seats taken'} />
          </div>
          <div>
            <p className={arena.caption}>Fifty join attempts, in the order the database resolved them</p>
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
          </div>
        </div>
        <div aria-live="polite">
          {done && result && (
            <p className={arena.verdict}>
              <strong>{result.winners}</strong> got the seat, <strong>{result.outcomes.TEAM_FULL ?? 0}</strong> were turned away because the team was full, and the
              invariant check found <strong>{result.invariantViolations}</strong> violations. All {result.attempts} attempts resolved in <strong>{result.durationMs} ms</strong>.
            </p>
          )}
          {done && result && (
            <p className={styles.muted} style={{ marginTop: 'var(--s-3)' }}>
              {result.winnerName} was dealt the last seat. The team appeared on <Link to={`/h/${hackathon.slug}`}>the board</Link> for everyone and folds itself in a few seconds so the bots can race again.
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
