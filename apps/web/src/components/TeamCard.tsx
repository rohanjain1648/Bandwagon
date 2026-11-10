import type { TeamSnapshot } from '@bw/shared';
import { Link } from 'react-router-dom';
import { seatsLeftLabel, teamNumber, utc } from '../lib/format';
import { SeatSlots, type ClaimPhase } from './SeatSlots';
import { Badge, Button, SkillChip } from './ui';
import styles from './TeamCard.module.css';

export type CardAction = 'join' | 'request' | 'requested' | 'mine' | 'full' | 'elsewhere' | 'gone';

export interface TeamCardProps {
  team: TeamSnapshot & { removed?: boolean };
  slug: string;
  action: CardAction;
  viewerId?: string;
  viewerName?: string;
  claim?: ClaimPhase | null;
  highlight?: string[];
  onJoin?: () => void;
  onRequest?: () => void;
}

export function TeamCard({ team, slug, action, viewerId, viewerName, claim, highlight = [], onJoin, onRequest }: TeamCardProps) {
  const full = team.memberCount >= team.maxSize;
  const lit = new Set(highlight);
  const filtering = lit.size > 0;
  const wanted = team.lookingFor.filter((s) => !team.skills.includes(s));
  const left = team.maxSize - team.memberCount;
  const href = action === 'mine' ? `/h/${slug}/team` : `/h/${slug}/teams/${team.id}`;
  const headingId = `team-${team.id}`;

  return (
    <article className={styles.card} aria-labelledby={headingId} data-full={full ? '' : undefined} data-gone={team.removed ? '' : undefined}>
      <header className={styles.top}>
        <span className={styles.number}>{teamNumber(team.number)}</span>
        <span className={styles.policy}>{team.joinPolicy === 'open' ? 'Open join' : 'Approval'}</span>
        <span className={styles.tz} title="Leader’s time zone">
          {utc(team.leaderOffsetMinutes)}
        </span>
      </header>

      <h3 className={styles.name} id={headingId}>
        <Link to={href} className={styles.link}>
          {team.name}
        </Link>
      </h3>
      {team.description && <p className={styles.pitch}>{team.description}</p>}

      <SeatSlots members={team.members} maxSize={team.maxSize} viewerId={viewerId} viewerName={viewerName} claim={claim} />

      {(team.skills.length > 0 || wanted.length > 0) && (
        <ul className={styles.skills} aria-label="Skills on the team and skills wanted">
          {team.skills.slice(0, 5).map((s) => (
            <li key={s}>
              <SkillChip id={s} lit={lit.has(s)} dim={filtering && !lit.has(s)} />
            </li>
          ))}
          {wanted.slice(0, 3).map((s) => (
            <li key={`w-${s}`}>
              <SkillChip id={s} wanted lit={lit.has(s)} dim={filtering && !lit.has(s)} />
            </li>
          ))}
        </ul>
      )}

      <footer className={styles.foot}>
        <span className={styles.left} data-urgent={left === 1 && !team.rosterLocked ? '' : undefined}>
          {team.removed ? 'Disbanded' : seatsLeftLabel(team.memberCount, team.maxSize, team.rosterLocked)}
        </span>
        <CardButton action={team.removed ? 'gone' : full && action !== 'mine' ? 'full' : action} claim={claim} name={team.name} onJoin={onJoin} onRequest={onRequest} href={href} />
      </footer>
      {full && !team.removed && (
        <span className={styles.stamp} aria-hidden>
          Full hand
        </span>
      )}
    </article>
  );
}

function CardButton({ action, claim, name, onJoin, onRequest }: { action: CardAction; claim?: ClaimPhase | null; name: string; onJoin?: () => void; onRequest?: () => void; href: string }) {
  switch (action) {
    case 'join':
      return (
        <Button size="sm" onClick={onJoin} busy={claim === 'claiming'} aria-label={`Join ${name}`}>
          Join
        </Button>
      );
    case 'request':
      return (
        <Button size="sm" variant="secondary" onClick={onRequest} aria-label={`Ask to join ${name}`}>
          Ask to join
        </Button>
      );
    case 'requested':
      return <Badge tone="shell">Requested</Badge>;
    case 'mine':
      return <Badge tone="success">Your team</Badge>;
    case 'full':
      return <Badge>Full</Badge>;
    case 'gone':
      return <Badge>Gone</Badge>;
    default:
      return null;
  }
}
