import type { PersonSnapshot } from '@bw/shared';
import { initials, localTime, roleOf, roleVar, utc } from '../lib/format';
import { SkillChip } from './ui';
import styles from './PersonCard.module.css';
import type { ReactNode } from 'react';

/** A participant as a card: portrait plate in their skill-type colour, stat block below. */
export function PersonCard({ person, highlight = [], action, children }: { person: PersonSnapshot & { gone?: boolean }; highlight?: string[]; action?: ReactNode; children?: ReactNode }) {
  const role = roleOf(person.skills);
  const lit = new Set(highlight);
  const hid = `person-${person.id}`;
  return (
    <article className={styles.card} aria-labelledby={hid} data-gone={person.gone ? '' : undefined}>
      <div className={styles.head}>
        <span className={styles.plate} style={{ ['--fill' as string]: roleVar(role) }} aria-hidden>
          {initials(person.displayName)}
        </span>
        <div className={styles.who}>
          <h3 id={hid} className={styles.name}>
            {person.displayName}
          </h3>
          <p className={styles.time}>
            {utc(person.utcOffsetMinutes)}, {localTime(person.utcOffsetMinutes)} there now
          </p>
        </div>
      </div>
      {person.bio && <p className={styles.bio}>{person.bio}</p>}
      <ul className={styles.skills} aria-label="Skills">
        {person.skills.map((s) => (
          <li key={s}>
            <SkillChip id={s} lit={lit.has(s)} dim={lit.size > 0 && !lit.has(s)} />
          </li>
        ))}
      </ul>
      <dl className={styles.stats}>
        <div>
          <dt>Works</dt>
          <dd>
            {String(person.workStartHour).padStart(2, '0')}:00 to {String(person.workEndHour).padStart(2, '0')}:00
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{person.gone ? 'Joined a team' : 'Looking for a team'}</dd>
        </div>
      </dl>
      {children}
      {action && <div className={styles.action}>{action}</div>}
    </article>
  );
}
