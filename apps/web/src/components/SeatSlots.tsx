import type { MemberSnapshot } from '@bw/shared';
import { Crown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { initials, localTime, roleOf, roleVar, skillLabel } from '../lib/format';
import styles from './SeatSlots.module.css';

export type ClaimPhase = 'claiming' | 'bounced';

export interface SeatSlotsProps {
  members: MemberSnapshot[];
  maxSize: number;
  viewerId?: string;
  /** an optimistic seat for the viewer: hatched while claiming, bounces out if the race was lost */
  claim?: ClaimPhase | null;
  viewerName?: string;
  size?: 'sm' | 'lg';
  label?: string;
}

/**
 * The signature: a team is a hand of seats. Filled seats are mini-cards in the
 * member's skill-type colour; open seats are outlined; your own seat has a foil
 * edge; a claim in flight is hatched. When a seat fills live, the new card is
 * dealt into its slot. Every state is also a printed mark and spoken text,
 * never colour alone.
 */
export function SeatSlots({ members, maxSize, viewerId, claim, viewerName = 'You', size = 'sm', label }: SeatSlotsProps) {
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const m of members) if (!seen.current.has(m.id)) fresh.add(m.id);
  useEffect(() => {
    seen.current = new Set(members.map((m) => m.id));
  });

  const open = Math.max(0, maxSize - members.length - (claim ? 1 : 0));
  const taken = members.length;
  // monograms must tell seats apart: on a collision, fall back to the first two letters of the first name
  const used = new Set<string>();
  const monogram = new Map<string, string>();
  for (const m of members) {
    let mono = initials(m.displayName);
    if (used.has(mono)) {
      const first = [...(m.displayName.trim().split(/\s+/)[0] ?? '')].slice(0, 2).join('').toUpperCase();
      if (first.length === 2 && !used.has(first)) mono = first;
    }
    used.add(mono);
    monogram.set(m.id, mono);
  }
  return (
    <ol className={styles.seats} data-size={size} aria-label={label ?? `${taken} of ${maxSize} seats taken`} style={{ ['--n' as string]: maxSize }}>
      {members.map((m, i) => {
        const role = roleOf(m.skills);
        const you = m.id === viewerId;
        return (
          <li
            key={m.id}
            className={styles.seat}
            data-state="taken"
            data-you={you ? '' : undefined}
            data-dealt={fresh.has(m.id) ? '' : undefined}
            style={{ ['--fill' as string]: roleVar(role) }}
          >
            <span className={styles.face} aria-hidden>
              <span className={styles.initials}>{monogram.get(m.id)}</span>
              {m.isLeader && <Crown className={styles.crown} size={size === 'lg' ? 14 : 11} strokeWidth={2.5} />}
            </span>
            {size === 'lg' ? (
              <span className={styles.detail}>
                <span className={styles.name}>{you ? `${m.displayName} (you)` : m.displayName}</span>
                <span className={styles.meta}>{m.skills.slice(0, 2).map(skillLabel).join(', ') || 'No skills listed'}</span>
                <span className={styles.meta}>{localTime(m.utcOffsetMinutes)} local</span>
              </span>
            ) : (
              <span className={styles.tag} aria-hidden>
                {m.skills[0] ? skillLabel(m.skills[0]) : ''}
              </span>
            )}
            <span className="visually-hidden">
              Seat {i + 1}: {m.displayName}
              {m.isLeader ? ', leader' : ''}
              {you ? ', you' : ''}
              {m.skills.length ? `, ${m.skills.slice(0, 3).map(skillLabel).join(', ')}` : ''}
            </span>
          </li>
        );
      })}
      {claim && (
        <li className={styles.seat} data-state="claiming" data-phase={claim}>
          <span className={styles.face} aria-hidden>
            <span className={styles.initials}>{initials(viewerName)}</span>
          </span>
          <span className={styles.tag} aria-hidden>
            {claim === 'bounced' ? 'Taken' : 'Joining'}
          </span>
          <span className="visually-hidden">{claim === 'bounced' ? 'Seat taken by someone else' : 'Claiming a seat for you'}</span>
        </li>
      )}
      {Array.from({ length: open }, (_, i) => (
        <li key={`open-${i}`} className={styles.seat} data-state="open">
          <span className={styles.openMark} aria-hidden>
            Open
          </span>
          <span className="visually-hidden">Seat {taken + (claim ? 1 : 0) + i + 1}: open</span>
        </li>
      ))}
    </ol>
  );
}
