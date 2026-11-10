import { ROLE_LABELS, type Role } from '@bw/shared';
import { Link } from 'react-router-dom';
import { PersonCard } from '../components/PersonCard';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { useShell } from '../components/Shell';
import { Panel, SkillChip, Spinner } from '../components/ui';
import { listSkills, seatsLeftLabel } from '../lib/format';
import { usePeopleSuggestions, useTeamSuggestions } from '../lib/queries';
import styles from './pages.module.css';

export function SuggestionsPage() {
  const { hackathon } = useShell();
  const onTeam = Boolean(hackathon.me?.teamId);
  const people = usePeopleSuggestions(hackathon.id, 12);
  const teams = useTeamSuggestions(hackathon.id, 8, !onTeam);
  const p = people.data?.perspective;
  const scoring = people.data?.scoring ?? teams.data?.scoring;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>For you</h1>
        <p className={styles.lede}>
          {onTeam ? (
            <>
              Ranked for your team{p?.want.length ? <>, which wants {listSkills(p.want, 4)}</> : ''}
              {p?.missingRoles.length ? <>. Nobody covers {p.missingRoles.map((r) => ROLE_LABELS[r as Role]).join(', ')} yet</> : ''}.
            </>
          ) : (
            'Teams you would complete, and people you would pair well with, ranked by complementary skills and shared working hours.'
          )}
        </p>
      </header>

      <div className={styles.split}>
        <div className={styles.stack}>
          {!onTeam && (
            <Panel title="Teams that need you">
              {teams.isLoading && <Spinner label="Scoring teams" />}
              <ol className={styles.fitList}>
                {teams.data?.items.map((s) => (
                  <li key={s.team.id} className={styles.fit}>
                    <div className={styles.fitTop}>
                      <Link className={styles.fitName} to={`/h/${hackathon.slug}/teams/${s.team.id}`}>
                        {s.team.name}
                      </Link>
                      <span className={styles.muted}>{seatsLeftLabel(s.team.memberCount, s.team.maxSize, s.team.rosterLocked)}</span>
                    </div>
                    <ScoreBreakdown score={s} />
                  </li>
                ))}
              </ol>
            </Panel>
          )}
          <Panel title={onTeam ? 'People to invite' : 'People to team up with'}>
            {people.isLoading && <Spinner label="Scoring people" />}
            <ul className={styles.cards}>
              {people.data?.items.map((s) => (
                <li key={s.person.id}>
                  <PersonCard person={s.person} highlight={s.matchedSkills}>
                    <ScoreBreakdown score={s} />
                  </PersonCard>
                </li>
              ))}
            </ul>
            {people.data && <p className={styles.muted} style={{ marginTop: 'var(--s-4)' }}>Scored {people.data.poolSize.toLocaleString()} candidates.</p>}
          </Panel>
        </div>
        <aside className={styles.aside} aria-labelledby="how-title">
          <Panel as="div" title={<span id="how-title">How the score works</span>}>
            {scoring && (
              <div className={styles.formGrid}>
                <p>{scoring.formula}</p>
                <dl className={styles.dl}>
                  <dt>Complementary skills</dt>
                  <dd>{scoring.weights.complement} points</dd>
                  <dt>Time-zone overlap</dt>
                  <dd>{scoring.weights.timezone} points</dd>
                  <dt>Skill novelty</dt>
                  <dd>{scoring.weights.novelty} points</dd>
                </dl>
                <ul className={styles.formGrid} style={{ paddingLeft: '1.1em', margin: 0 }}>
                  {scoring.notes.map((n) => (
                    <li key={n} className={styles.muted}>
                      {n}
                    </li>
                  ))}
                </ul>
                {p && p.have.length > 0 && (
                  <div>
                    <p className={styles.muted} style={{ marginBottom: 6 }}>
                      {onTeam ? 'Your team already has' : 'You bring'}
                    </p>
                    <div className={styles.row}>
                      {p.have.map((s) => (
                        <SkillChip key={s} id={s} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
