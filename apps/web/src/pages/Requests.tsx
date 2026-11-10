import { Link } from 'react-router-dom';
import { useShell } from '../components/Shell';
import { Badge, Button, EmptyState, Panel, Spinner } from '../components/ui';
import { relative, teamNumber } from '../lib/format';
import { useCancelRequest } from '../lib/mutations';
import { useMyRequests, useTeam } from '../lib/queries';
import styles from './pages.module.css';
import team from './team.module.css';

const STATUS: Record<string, { label: string; tone: 'shell' | 'success' | 'neutral' | 'danger' }> = {
  pending: { label: 'Waiting for the leader', tone: 'shell' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Closed', tone: 'neutral' },
};

export function RequestsPage() {
  const { hackathon } = useShell();
  const mine = useMyRequests(hackathon.id);
  const myTeam = useTeam(hackathon.me?.teamId);
  const cancel = useCancelRequest(hackathon);
  const base = `/h/${hackathon.slug}`;
  const items = mine.data?.items ?? [];
  const incoming = myTeam.data?.viewer.isLeader ? myTeam.data.requests.length : 0;

  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <header>
        <h1 className={styles.title}>Requests</h1>
        <p className={styles.lede}>You can have up to 5 requests waiting at once. When you join any team, the rest close automatically.</p>
      </header>
      {myTeam.data?.viewer.isLeader && (
        <Panel title="Waiting for you">
          <p>
            {incoming === 0 ? 'Nobody is waiting on your team right now.' : `${incoming} ${incoming === 1 ? 'person is' : 'people are'} waiting for your answer.`}{' '}
            <Link to={`${base}/team`}>Open your team’s inbox</Link>
          </p>
        </Panel>
      )}
      <Panel title="Requests you sent">
        {mine.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No requests yet" action={<Link to={base}>Find a team on the board</Link>}>
            Teams that approve members show an “Ask to join” button.
          </EmptyState>
        ) : (
          <ul className={team.list}>
            {items.map((r) => {
              const s = STATUS[r.status]!;
              return (
                <li key={r.id} className={team.request}>
                  <div className={styles.row} style={{ justifyContent: 'space-between' }}>
                    <div>
                      <p className={team.personName}>
                        {r.teamNumber ? <Link to={`${base}/teams/${r.teamId}`}>{r.teamName}</Link> : r.teamName}
                      </p>
                      <p className={styles.muted}>
                        {r.teamNumber ? `${teamNumber(r.teamNumber)}, ` : ''}sent {relative(r.createdAt)}
                        {r.decidedAt ? `, answered ${relative(r.decidedAt)}` : ''}
                      </p>
                    </div>
                    <div className={styles.row}>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {r.status === 'pending' && !r.id.startsWith('optimistic') && (
                        <Button size="sm" variant="quiet" onClick={() => cancel.mutate({ requestId: r.id })}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                  {r.message && <blockquote className={team.message}>{r.message}</blockquote>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
