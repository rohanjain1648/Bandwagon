import { ROLES, ROLE_LABELS, SKILLS, type TeamSnapshot } from '@bw/shared';
import * as Tabs from '@radix-ui/react-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal, ModalActions } from '../components/Modal';
import { PersonCard } from '../components/PersonCard';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { useShell } from '../components/Shell';
import { TeamCard, type CardAction } from '../components/TeamCard';
import { Button, EmptyState, ErrorNote, Field, Input, Panel, Select, SkillChip, Spinner, Textarea } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { errorMessage } from '../lib/api';
import { plural } from '../lib/format';
import { useClaimSeat, useRequestToJoin } from '../lib/mutations';
import { useBoardPeople, useBoardTeams, useMyRequests, usePeopleSuggestions, useTeam, useTeamSuggestions } from '../lib/queries';
import styles from './pages.module.css';

const QUICK_SKILLS = ['react', 'node', 'python', 'go', 'figma', 'pytorch', 'llm', 'swift', 'docker'];

export function BoardPage() {
  const { hackathon, live, newTeams, clearNewTeams } = useShell();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'people' ? 'people' : 'teams';
  const skills = useMemo(() => (params.get('skills') ?? '').split(',').filter(Boolean), [params]);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [moreOpen, setMoreOpen] = useState(false);
  const extraSelected = skills.filter((s) => !QUICK_SKILLS.includes(s)).length;

  // debounce search into the URL so filters are shareable and survive refresh
  useEffect(() => {
    const t = setTimeout(() => update({ q: q.trim() || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function update(patch: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  }

  const toggleSkill = (id: string) => {
    const set = new Set(skills);
    if (set.has(id)) set.delete(id);
    else if (set.size < 6) set.add(id);
    update({ skills: [...set].join(',') || null });
  };

  const apiParams = useMemo(() => {
    const p = new URLSearchParams({ limit: '24' });
    if (params.get('q')) p.set('q', params.get('q')!);
    if (skills.length) p.set('skills', skills.join(','));
    if (params.get('tz')) p.set('tz', params.get('tz')!);
    if (view === 'teams') {
      if (params.get('policy')) p.set('policy', params.get('policy')!);
      if (params.get('sort')) p.set('sort', params.get('sort')!);
    }
    return p;
  }, [params, skills, view]);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Looking for teammates</h1>
          <p className={styles.lede}>
            <strong>{plural(hackathon.stats.openTeams, 'team')}</strong> {hackathon.stats.openTeams === 1 ? 'has' : 'have'} open seats and{' '}
            <strong>{plural(hackathon.stats.looking, 'person', 'people')}</strong> {hackathon.stats.looking === 1 ? 'is' : 'are'} looking. Seats update the moment someone takes one.
          </p>
        </div>
        <span className="visually-hidden" aria-live="off">
          {live === 'live' ? 'Board is live' : 'Reconnecting to live updates'}
        </span>
      </header>

      <div className={styles.split}>
        <Tabs.Root value={view} onValueChange={(v) => update({ view: v === 'people' ? 'people' : null })} className={styles.stack}>
          <div className={styles.toolbar}>
            <div className={styles.toolRow}>
              <Tabs.List className={styles.tabs} aria-label="What to browse">
                <Tabs.Trigger value="teams" className={styles.tab}>
                  Teams with open seats
                </Tabs.Trigger>
                <Tabs.Trigger value="people" className={styles.tab}>
                  People looking
                </Tabs.Trigger>
              </Tabs.List>
              <div className={`${styles.grow} ${styles.searchWrap}`}>
                <Search size={18} className={styles.searchIcon} aria-hidden />
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={view === 'teams' ? 'Search teams by name' : 'Search people by name'}
                  aria-label={view === 'teams' ? 'Search teams by name' : 'Search people by name'}
                  maxLength={60}
                />
              </div>
            </div>
            <fieldset className={`${styles.filterSkills} ${styles.scrollRow}`}>
              <legend className="visually-hidden">Filter by skill (up to six)</legend>
              {QUICK_SKILLS.map((id) => (
                <SkillToggle key={id} id={id} on={skills.includes(id)} onToggle={toggleSkill} />
              ))}
              <button type="button" className={styles.toggle} aria-expanded={moreOpen} aria-controls="more-skills" onClick={() => setMoreOpen((o) => !o)}>
                {moreOpen ? 'Fewer skills' : 'More skills'}
                {extraSelected ? ` (${extraSelected})` : ''}
              </button>
            </fieldset>
            {moreOpen && (
              <div id="more-skills" className={styles.morePanel}>
                {ROLES.map((role) => (
                  <div key={role} className={styles.roleGroup}>
                    <span className={styles.roleName}>{ROLE_LABELS[role]}</span>
                    <div className={styles.filterSkills}>
                      {SKILLS.filter((s) => s.role === role).map((s) => (
                        <SkillToggle key={s.id} id={s.id} on={skills.includes(s.id)} onToggle={toggleSkill} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className={`${styles.toolRow} ${styles.selectRow}`}>
              <Select className={styles.compactSelect} value={params.get('tz') ?? ''} onChange={(e) => update({ tz: e.target.value || null })} aria-label="Time zone distance from you">
                <option value="">Any time zone</option>
                <option value="2">Within 2 h</option>
                <option value="4">Within 4 h</option>
                <option value="6">Within 6 h</option>
              </Select>
              {view === 'teams' && (
                <>
                  <Select className={styles.compactSelect} value={params.get('policy') ?? ''} onChange={(e) => update({ policy: e.target.value || null })} aria-label="How the team takes members">
                    <option value="">Any policy</option>
                    <option value="open">Open join</option>
                    <option value="approval">Approval</option>
                  </Select>
                  <Select className={styles.compactSelect} value={params.get('sort') ?? ''} onChange={(e) => update({ sort: e.target.value || null })} aria-label="Sort teams">
                    <option value="">Newest</option>
                    <option value="filling">Almost full</option>
                  </Select>
                </>
              )}
              {(skills.length > 0 || params.get('q') || params.get('tz') || params.get('policy')) && (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setQ('');
                    update({ skills: null, q: null, tz: null, policy: null });
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          <Tabs.Content value="teams" className={styles.stack}>
            <h2 className="visually-hidden">Teams with open seats</h2>
            {newTeams.length > 0 && <NewTeamsPill count={newTeams.length} onShow={clearNewTeams} hid={hackathon.id} />}
            <TeamsGrid params={apiParams} highlight={skills} />
          </Tabs.Content>
          <Tabs.Content value="people" className={styles.stack}>
            <h2 className="visually-hidden">People looking for a team</h2>
            <PeopleGrid params={apiParams} highlight={skills} />
          </Tabs.Content>
        </Tabs.Root>

        <GoodFits />
      </div>
    </div>
  );
}

function SkillToggle({ id, on, onToggle }: { id: string; on: boolean; onToggle: (id: string) => void }) {
  const s = SKILLS.find((x) => x.id === id)!;
  return (
    <button type="button" className={styles.toggle} aria-pressed={on} onClick={() => onToggle(id)} style={{ ['--chip' as string]: `var(--role-${s.role})` }}>
      {s.label}
    </button>
  );
}

function NewTeamsPill({ count, onShow, hid }: { count: number; onShow: () => void; hid: string }) {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className={styles.newPill}
      onClick={() => {
        onShow();
        void qc.invalidateQueries({ queryKey: ['board', 'teams', hid] });
      }}
    >
      {count === 1 ? '1 new team' : `${count} new teams`} just formed. Show them
    </button>
  );
}

function TeamsGrid({ params, highlight }: { params: URLSearchParams; highlight: string[] }) {
  const { hackathon, me } = useShell();
  const board = useBoardTeams(hackathon.id, params);
  const requests = useMyRequests(hackathon.id);
  const { claims, claim } = useClaimSeat(hackathon);
  const requestToJoin = useRequestToJoin(hackathon);
  const [asking, setAsking] = useState<TeamSnapshot | null>(null);
  const myTeamId = hackathon.me?.teamId ?? null;
  const requested = new Set((requests.data?.items ?? []).filter((r) => r.status === 'pending').map((r) => r.teamId));

  if (board.isLoading) return <Spinner label="Loading teams" />;
  if (board.isError) return <ErrorNote>{errorMessage(board.error)}</ErrorNote>;
  const teams = board.data?.pages.flatMap((p) => p.items) ?? [];
  const total = board.data?.pages[0]?.total ?? teams.length;

  const actionFor = (t: TeamSnapshot): CardAction => {
    if (t.id === myTeamId) return 'mine';
    if (myTeamId) return 'elsewhere';
    if (requested.has(t.id)) return 'requested';
    return t.joinPolicy === 'open' ? 'join' : 'request';
  };

  if (teams.length === 0)
    return (
      <EmptyState title="No teams match those filters" action={<Link to={`/h/${hackathon.slug}/team`}>Start a team instead</Link>}>
        Try fewer skills or a wider time zone. Or start your own team and let people come to you.
      </EmptyState>
    );

  return (
    <>
      <p className={styles.resultLine}>
        <span>
          Showing {teams.length.toLocaleString()} of {total.toLocaleString()} {total === 1 ? 'team' : 'teams'}
        </span>
        {myTeamId && <span className={styles.muted}>You’re on a team. Leave it to join another.</span>}
      </p>
      <ul className={styles.cards}>
        {teams.map((t) => (
          <li key={t.id}>
            <TeamCard
              team={t}
              slug={hackathon.slug}
              action={actionFor(t)}
              viewerId={me.user.id}
              viewerName={me.user.displayName}
              claim={claims[t.id] ?? null}
              highlight={highlight}
              onJoin={() => claim({ teamId: t.id, teamName: t.name })}
              onRequest={() => setAsking(t)}
              of={hackathon.stats.teams}
            />
          </li>
        ))}
      </ul>
      {board.hasNextPage && (
        <Button variant="secondary" className={styles.loadMore} busy={board.isFetchingNextPage} onClick={() => void board.fetchNextPage()}>
          Show more teams
        </Button>
      )}
      <RequestDialog
        team={asking}
        onClose={() => setAsking(null)}
        busy={requestToJoin.isPending}
        onSend={(message) => {
          if (!asking) return;
          requestToJoin.mutate({ teamId: asking.id, teamName: asking.name, message }, { onSettled: () => setAsking(null) });
        }}
      />
    </>
  );
}

export function RequestDialog({ team, onClose, onSend, busy }: { team: TeamSnapshot | null; onClose: () => void; onSend: (message: string) => void; busy: boolean }) {
  const [message, setMessage] = useState('');
  useEffect(() => setMessage(''), [team?.id]);
  return (
    <Modal open={Boolean(team)} onOpenChange={(o) => !o && onClose()} title={team ? `Ask to join ${team.name}` : ''} description="The leader sees your skills and time zone. A line about what you’d bring helps.">
      <form
        className={styles.formGrid}
        onSubmit={(e) => {
          e.preventDefault();
          onSend(message);
        }}
      >
        <Field label="Message to the leader" optional hint={`${280 - [...message].length} characters left`}>
          {(p) => <Textarea {...p} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={280} placeholder="I can own the backend and the demo deploy." />}
        </Field>
        <ModalActions>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            Send request
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function PeopleGrid({ params, highlight }: { params: URLSearchParams; highlight: string[] }) {
  const { hackathon } = useShell();
  const people = useBoardPeople(hackathon.id, params);
  const myTeam = useTeam(hackathon.me?.teamId);
  const { toast } = useAnnounce();
  const code = myTeam.data?.viewer.isLeader ? myTeam.data.invite?.code : undefined;

  if (people.isLoading) return <Spinner label="Loading people" />;
  if (people.isError) return <ErrorNote>{errorMessage(people.error)}</ErrorNote>;
  const items = people.data?.pages.flatMap((p) => p.items) ?? [];
  const total = people.data?.pages[0]?.total ?? items.length;
  if (items.length === 0) return <EmptyState title="Nobody matches those filters">Try fewer skills or any time zone.</EmptyState>;

  const copyInvite = async (name: string) => {
    if (!code) return;
    await navigator.clipboard.writeText(`${location.origin}/join/${code}`);
    toast({ tone: 'success', title: 'Invite link copied', body: `Send it to ${name}. It joins them straight onto your team.` });
  };

  return (
    <>
      <p className={styles.resultLine}>
        Showing {items.length.toLocaleString()} of {total.toLocaleString()} people looking for a team
      </p>
      <ul className={styles.cards}>
        {items.map((p) => (
          <li key={p.id}>
            <PersonCard
              person={p}
              highlight={highlight}
              action={
                code ? (
                  <Button size="sm" variant="secondary" onClick={() => void copyInvite(p.displayName)}>
                    Copy invite link
                  </Button>
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
      {people.hasNextPage && (
        <Button variant="secondary" className={styles.loadMore} busy={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
          Show more people
        </Button>
      )}
    </>
  );
}

/** What this pick specifically brings (lit chips) and how much of the day you share. */
function FitDetail({ s, skills }: { s: { matchedSkills: string[]; newRoles: string[]; overlapHours: number }; skills: string[] }) {
  const roleSkills = skills.filter((id) => !s.matchedSkills.includes(id) && s.newRoles.includes(SKILLS.find((x) => x.id === id)?.role ?? ''));
  const shown = [...s.matchedSkills, ...roleSkills].slice(0, 4);
  const h = s.overlapHours;
  return (
    <>
      {shown.length > 0 && (
        <div className={styles.fitSkills} aria-label="What they bring">
          {shown.map((id) => (
            <SkillChip key={id} id={id} lit />
          ))}
        </div>
      )}
      <p className={styles.fitWhy}>{h > 0 ? `${Number.isInteger(h) ? h : h.toFixed(1)} h of shared working hours` : 'No shared working hours'}</p>
    </>
  );
}

function TieNote({ scores }: { scores: number[] }) {
  if (scores.length < 2 || new Set(scores).size !== 1) return null;
  return <p className={styles.tieNote}>Tied at {scores[0]}. Ties go to whoever brings more of the missing skills, then more shared hours.</p>;
}

function GoodFits() {
  const { hackathon, me } = useShell();
  const onTeam = Boolean(hackathon.me?.teamId);
  const teams = useTeamSuggestions(hackathon.id, 3, !onTeam);
  const people = usePeopleSuggestions(onTeam ? hackathon.id : undefined, 3);
  const base = `/h/${hackathon.slug}`;
  return (
    <aside className={styles.aside} aria-labelledby="fits-title">
      <Panel as="div" title={<span id="fits-title">{onTeam ? 'People your team needs' : 'Good fits for you'}</span>}>
        {(onTeam ? people.isLoading : teams.isLoading) && <Spinner label="Scoring" />}
        <TieNote scores={(onTeam ? people.data?.items : teams.data?.items)?.map((x) => x.score) ?? []} />
        <ol className={styles.fitList}>
          {!onTeam &&
            teams.data?.items.map((s) => (
              <li key={s.team.id} className={styles.fit}>
                <div className={styles.fitTop}>
                  <Link className={styles.fitName} to={`${base}/teams/${s.team.id}`}>
                    {s.team.name}
                  </Link>
                  <span className={styles.fitScore} aria-label={`fit ${s.score} out of 100`}>
                    {s.score}
                  </span>
                </div>
                <ScoreBreakdown score={s} compact />
                <FitDetail s={s} skills={me.user.skills} />
              </li>
            ))}
          {onTeam &&
            people.data?.items.map((s) => (
              <li key={s.person.id} className={styles.fit}>
                <div className={styles.fitTop}>
                  <span className={styles.fitName}>{s.person.displayName}</span>
                  <span className={styles.fitScore} aria-label={`fit ${s.score} out of 100`}>
                    {s.score}
                  </span>
                </div>
                <ScoreBreakdown score={s} compact />
                <FitDetail s={s} skills={s.person.skills} />
              </li>
            ))}
        </ol>
        <p style={{ marginTop: 'var(--s-4)' }}>
          <Link to={`${base}/for-you`}>See every suggestion and how the score works</Link>
        </p>
      </Panel>
    </aside>
  );
}
