import { formatInviteCode, normalizeInviteCode, type TeamDetail } from '@bw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SeatSlots, type ClaimPhase } from '../components/SeatSlots';
import { Wordmark } from '../components/Shell';
import { Button, ErrorNote, Panel, SkillChip, Spinner } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { ApiError, api, errorMessage, newKey } from '../lib/api';
import { expiresIn, teamNumber } from '../lib/format';
import { keys, useInvitePreview, useMe } from '../lib/queries';
import styles from './pages.module.css';
import auth from './auth.module.css';

/** /join/:code: preview the team, then take the seat (optimistic, rollback on a lost race). */
export function JoinByCodePage() {
  const { code: raw = '' } = useParams();
  const code = normalizeInviteCode(raw);
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  const preview = useInvitePreview(code ?? undefined);
  const [phase, setPhase] = useState<ClaimPhase | null>(null);
  const [error, setError] = useState('');
  const [key] = useState(newKey);

  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  const hackathon = me.data.hackathons.find((h) => h.id === preview.data?.team.hackathonId);

  async function join() {
    if (!code) return;
    setPhase('claiming');
    setError('');
    try {
      const t = await api.post<TeamDetail>('/invites/redeem', { code }, key);
      qc.setQueryData(keys.team(t.id), t);
      await qc.invalidateQueries();
      toast({ tone: 'success', title: `You’re on ${t.name}`, body: `Seat ${t.memberCount} of ${t.maxSize} is yours.` });
      navigate(`/h/${hackathon?.slug ?? 'hack4hack-2026'}/team`);
    } catch (err) {
      setPhase('bounced');
      setTimeout(() => setPhase(null), 700);
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'TEAM_FULL') void preview.refetch();
    }
  }

  return (
    <div className={auth.screen}>
      <div className={auth.brandRow}>
        <Wordmark inverted={false} />
      </div>
      <main id="main" className={`${styles.page} ${styles.narrow}`} style={{ width: '100%' }}>
        {!code ? (
          <Panel title="That doesn’t look like an invite code">
            <p className={styles.muted}>Codes have 12 letters and numbers, like K7QM-4XHT-9RJP. Check the link your leader sent.</p>
          </Panel>
        ) : preview.isLoading ? (
          <Spinner label="Checking the code" />
        ) : preview.isError ? (
          <>
            <h1 className={styles.title}>This code can’t be used</h1>
            <ErrorNote>{errorMessage(preview.error)}</ErrorNote>
            <p>
              <Link to="/">Browse teams on the board</Link>
            </p>
          </>
        ) : preview.data ? (
          <>
            <header>
              <p className={styles.muted}>
                Invite code <span className="code">{formatInviteCode(code)}</span>, expires in {expiresIn(preview.data.expiresAt)}
              </p>
              <h1 className={styles.title}>Join {preview.data.team.name}?</h1>
              {preview.data.team.description && <p className={styles.lede}>{preview.data.team.description}</p>}
            </header>
            <Panel title={`${teamNumber(preview.data.team.number)}: ${preview.data.team.memberCount} of ${preview.data.team.maxSize} seats taken`}>
              <SeatSlots members={preview.data.team.members} maxSize={preview.data.team.maxSize} claim={phase} viewerName={me.data.user.displayName} size="lg" />
              <div className={styles.row} style={{ marginTop: 'var(--s-4)' }}>
                {preview.data.team.skills.map((s) => (
                  <SkillChip key={s} id={s} />
                ))}
              </div>
            </Panel>
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className={styles.row}>
              <Button size="lg" busy={phase === 'claiming'} onClick={() => void join()} disabled={preview.data.team.memberCount >= preview.data.team.maxSize}>
                {preview.data.team.memberCount >= preview.data.team.maxSize ? 'This team is full' : 'Take the seat'}
              </Button>
              <Link to={`/h/${hackathon?.slug ?? 'hack4hack-2026'}`}>Not now, show me the board</Link>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
