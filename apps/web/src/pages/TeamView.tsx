import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { SeatSlots } from '../components/SeatSlots';
import { useShell } from '../components/Shell';
import { Badge, Button, ErrorNote, Panel, SkillChip, Spinner } from '../components/ui';
import { errorMessage } from '../lib/api';
import { seatsLeftLabel, skillLabel, teamNumber, utc } from '../lib/format';
import { useCancelRequest, useClaimSeat, useRequestToJoin } from '../lib/mutations';
import { useMyRequests, useTeam } from '../lib/queries';
import { RequestDialog } from './Board';
import styles from './pages.module.css';
import team from './team.module.css';

export function TeamViewPage() {
  const { teamId = '' } = useParams();
  const { hackathon, me } = useShell();
  const q = useTeam(teamId);
  const mine = useMyRequests(hackathon.id);
  const { claims, claim } = useClaimSeat(hackathon);
  const ask = useRequestToJoin(hackathon);
  const cancel = useCancelRequest(hackathon);
  const [asking, setAsking] = useState(false);

  if (q.isLoading) return <Spinner label="Loading team" />;
  if (q.isError || !q.data)
    return (
      <div className={`${styles.page} ${styles.narrow}`}>
        <h1 className={styles.title}>Team not found</h1>
        <ErrorNote>{errorMessage(q.error)}</ErrorNote>
        <Link to={`/h/${hackathon.slug}`}>Back to the board</Link>
      </div>
    );
  const t = q.data;
  if (t.viewer.isMember) return <Navigate to={`/h/${hackathon.slug}/team`} replace />;
  const full = t.memberCount >= t.maxSize;
  const pending = mine.data?.items.find((r) => r.teamId === t.id && r.status === 'pending');
  const wanted = t.lookingFor.filter((s) => !t.skills.includes(s));

  let action = null;
  if (t.viewer.onAnotherTeam) action = <p className={styles.muted}>You’re on another team. Leave it first to join this one.</p>;
  else if (t.rosterLocked) action = <Badge>Roster locked</Badge>;
  else if (full) action = <Badge>Full</Badge>;
  else if (pending)
    action = (
      <div className={styles.row}>
        <Badge tone="shell">Request pending</Badge>
        <Button size="sm" variant="quiet" busy={cancel.isPending} onClick={() => cancel.mutate({ requestId: pending.id })} disabled={pending.id.startsWith('optimistic')}>
          Cancel request
        </Button>
      </div>
    );
  else if (t.joinPolicy === 'open')
    action = (
      <Button size="lg" busy={claims[t.id] === 'claiming'} onClick={() => claim({ teamId: t.id, teamName: t.name })}>
        Take a seat
      </Button>
    );
  else
    action = (
      <Button size="lg" variant="secondary" onClick={() => setAsking(true)}>
        Ask to join
      </Button>
    );

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <header>
        <p className={team.number}>
          {teamNumber(t.number)}, leader in {utc(t.leaderOffsetMinutes)}
        </p>
        <h1 className={styles.title}>{t.name}</h1>
        {t.description && <p className={styles.lede}>{t.description}</p>}
      </header>
      <Panel title={seatsLeftLabel(t.memberCount, t.maxSize, t.rosterLocked)} action={action}>
        <SeatSlots members={t.members} maxSize={t.maxSize} viewerId={me.user.id} viewerName={me.user.displayName} claim={claims[t.id] ?? null} size="lg" />
      </Panel>
      <div className={styles.twoUp}>
        <Panel title="Skills on the team">
          <div className={styles.row}>{t.skills.length ? t.skills.map((s) => <SkillChip key={s} id={s} />) : <span className={styles.muted}>None listed yet</span>}</div>
        </Panel>
        <Panel title="Looking for">
          <div className={styles.row}>
            {wanted.length ? wanted.map((s) => <SkillChip key={s} id={s} wanted />) : <span className={styles.muted}>Open to anyone</span>}
          </div>
          {wanted.length > 0 && <p className={styles.muted} style={{ marginTop: 'var(--s-3)' }}>Bring {wanted.map(skillLabel).join(' or ')} and you’ll rank high in their suggestions.</p>}
        </Panel>
      </div>
      <p>
        <Link to={`/h/${hackathon.slug}`}>Back to the board</Link>
      </p>
      <RequestDialog
        team={asking ? t : null}
        onClose={() => setAsking(false)}
        busy={ask.isPending}
        onSend={(message) => ask.mutate({ teamId: t.id, teamName: t.name, message }, { onSettled: () => setAsking(false) })}
      />
    </div>
  );
}
