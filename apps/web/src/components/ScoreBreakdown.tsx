import type { ScoreBreakdown as Score } from '@bw/shared';
import styles from './ScoreBreakdown.module.css';

const TONE: Record<string, string> = { complement: 'var(--shell)', timezone: 'var(--shell-hi)', novelty: 'var(--ink-3)' };

/**
 * The score explains itself: one bar split into its three weighted parts
 * (lengths are points out of 100), every part labelled with its points and
 * its reason in words. Nothing relies on colour alone.
 */
export function ScoreBreakdown({ score, compact = false }: { score: Score; compact?: boolean }) {
  return (
    <div className={styles.wrap} data-compact={compact ? '' : undefined}>
      {!compact && (
        <div className={styles.headline}>
          <span className={styles.score}>{score.score}</span>
          <span className={styles.of}>/ 100 fit</span>
        </div>
      )}
      <div
        className={styles.bar}
        role="img"
        aria-label={score.components.map((c) => `${c.label} ${c.points} of ${c.weight}`).join(', ')}
      >
        {score.components.map((c) => (
          <span key={c.key} className={styles.seg} data-key={c.key} style={{ width: `${c.points}%`, background: TONE[c.key] }} />
        ))}
      </div>
      {!compact && (
        <ul className={styles.parts}>
          {score.components.map((c) => (
            <li key={c.key}>
              <span className={styles.swatch} data-key={c.key} style={{ background: TONE[c.key] }} aria-hidden />
              <span className={styles.partLabel}>
                {c.label}{' '}
                <span className={styles.points}>
                  {c.points}/{c.weight}
                </span>
              </span>
              <span className={styles.reason}>{c.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
