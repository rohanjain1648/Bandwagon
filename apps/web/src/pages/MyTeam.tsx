import { INVITE_TTLS, SKILLS, formatInviteCode, normalizeInviteCode, type AuditEntryView, type TeamDetail } from '@bw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Crown, RefreshCw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Modal, ModalActions } from '../components/Modal';
import { SeatSlots } from '../components/SeatSlots';
import { useShell } from '../components/Shell';
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Panel, Select, SkillChip, Spinner, Textarea } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { ApiError, api, errorMessage, fieldErrors, newKey } from '../lib/api';
import { expiresIn, initials, localTime, relative, roleOf, roleVar, skillLabel, teamNumber, utc } from '../lib/format';
import { useDecide, useLeave, useNewInvite, useTeamCommand } from '../lib/mutations';
import { keys, useAudit, useTeam } from '../lib/queries';
import styles from './pages.module.css';
import team from './team.module.css';

export function MyTeamPage() {
  const { hackathon } = useShell();
  const teamId = hackathon.me?.teamId ?? null;
  const q = useTeam(teamId);
  if (!teamId) return <NoTeam />;
  if (q.isLoading) return <Spinner label="Loading your team" />;
  if (q.isError || !q.data) return <ErrorNote>{errorMessage(q.error)}</ErrorNote>;
  return <TeamRoom team={q.data} />;
}

// ── not on a team yet ──────────────────────────────────────────────────────

function NoTeam() {
  const { hackathon } = useShell();
  return (
    <div className={`${styles.page} ${styles.narrow}`}>
      <header>
        <h1 className={styles.title}>You’re not on a team yet</h1>
        <p className={styles.lede}>
          Start a team and share its invite code, or join one with a code a leader sent you. Teams in {hackathon.name} seat {hackathon.minTeamSize} to {hackathon.maxTeamSize} people.
        </p>
      </header>
      <div className={styles.twoUp}>
        <CreateTeam />
        <div className={styles.stack}>
          <JoinWithCode />
          <Panel title="Or browse">
            <p className={styles.muted}>
              <Link to={`/h/${hackathon.slug}`}>The board</Link> lists every team with an open seat, live.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function CreateTeam() {
  const { hackathon } = useShell();
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [joinPolicy, setJoinPolicy] = useState<'approval' | 'open'>('approval');
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [key] = useState(newKey); // one key per form: a double submit can never make two teams

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const t = await api.post<TeamDetail>(`/hackathons/${hackathon.id}/teams`, { name, description, joinPolicy, lookingFor }, key);
      qc.setQueryData(keys.team(t.id), t);
      await qc.invalidateQueries({ queryKey: keys.hackathon(hackathon.slug) });
      void qc.invalidateQueries({ queryKey: ['board'] });
      void qc.invalidateQueries({ queryKey: keys.me });
      toast({ tone: 'success', title: `${t.name} is on the board`, body: 'Share the invite code to fill your seats.' });
    } catch (err) {
      setErrors(fieldErrors(err));
      if (!(err instanceof ApiError && err.code === 'VALIDATION')) setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Start a team">
      <form className={styles.formGrid} onSubmit={submit} noValidate>
        <Field label="Team name" error={errors.name} hint="2 to 40 characters. Unique in this hackathon.">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="off" />}
        </Field>
        <Field label="Pitch" optional error={errors.description} hint="One line on what you’ll build.">
          {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} />}
        </Field>
        <Field label="How people join" hint={joinPolicy === 'open' ? 'Anyone can take an open seat instantly.' : 'People send a request; you accept or decline.'}>
          {(p) => (
            <Select {...p} value={joinPolicy} onChange={(e) => setJoinPolicy(e.target.value as 'open' | 'approval')}>
              <option value="approval">Approval: I accept each person</option>
              <option value="open">Open: first come, first seated</option>
            </Select>
          )}
        </Field>
        <SkillPicker legend="Skills you’re looking for" value={lookingFor} onChange={setLookingFor} max={8} optional />
        {formError && <ErrorNote>{formError}</ErrorNote>}
        <Button type="submit" busy={busy} size="lg">
          Create team
        </Button>
      </form>
    </Panel>
  );
}

function JoinWithCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  return (
    <Panel title="Join with a code">
      <form
        className={styles.formGrid}
        onSubmit={(e) => {
          e.preventDefault();
          const normal = normalizeInviteCode(code);
          if (!normal) {
            setError('Invite codes have 12 letters and numbers, like K7QM-4XHT-9RJP.');
            return;
          }
          navigate(`/join/${formatInviteCode(normal)}`);
        }}
      >
        <Field label="Invite code" error={error} hint="Dashes and lowercase are fine. You can paste the whole link.">
          {(p) => <Input {...p} className="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7QM-4XHT-9RJP" autoComplete="off" spellCheck={false} />}
        </Field>
        <Button type="submit" variant="secondary">
          Preview team
        </Button>
      </form>
    </Panel>
  );
}

export function SkillPicker({ legend, value, onChange, max, optional }: { legend: string; value: string[]; onChange: (v: string[]) => void; max: number; optional?: boolean }) {
  const full = value.length >= max;
  return (
    <fieldset className={styles.skillPicker}>
      <legend>
        {legend}
        <span className={styles.muted} style={{ fontWeight: 400 }}>
          {' '}
          {optional ? '(optional) ' : ''}
          {value.length}/{max}
        </span>
      </legend>
      <div className={styles.pickRow}>
        {SKILLS.map((s) => {
          const on = value.includes(s.id);
          return (
            <label key={s.id} className={styles.pick} style={{ ['--chip' as string]: `var(--role-${s.role})` }}>
              <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])} />
              <span>{s.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ── on a team ──────────────────────────────────────────────────────────────

function TeamRoom({ team: t }: { team: TeamDetail }) {
  const { me, hackathon } = useShell();
  const ready = t.memberCount >= t.minSize;
  const leaderName = t.members.find((m) => m.isLeader)?.displayName;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className={team.number}>{teamNumber(t.number)}</p>
          <h1 className={styles.title}>{t.name}</h1>
          {t.description && <p className={styles.lede}>{t.description}</p>}
        </div>
        <div className={styles.row}>
          <Badge tone={ready ? 'success' : 'warn'}>{ready ? `Ready: meets the minimum of ${t.minSize}` : `Needs ${t.minSize - t.memberCount} more to qualify`}</Badge>
          <Badge tone="shell">{t.joinPolicy === 'open' ? 'Open join' : 'Approval'}</Badge>
          {t.rosterLocked && <Badge>Roster locked</Badge>}
        </div>
      </header>

      <Panel title="The hand" action={<span className={styles.muted}>{t.memberCount} of {t.maxSize} seats</span>}>
        <SeatSlots members={t.members} maxSize={t.maxSize} viewerId={me.user.id} size="lg" />
        <p className={styles.muted} style={{ marginTop: 'var(--s-3)' }}>
          {t.viewer.isLeader ? 'You lead this team.' : `${leaderName ?? 'The leader'} leads this team.`} Leadership passes to the longest-serving member if the leader leaves.
        </p>
      </Panel>

      <div className={styles.twoUp}>
        {t.viewer.isLeader && <InviteCard team={t} />}
        {t.viewer.isLeader && <RequestInbox team={t} />}
        <MemberList team={t} />
        {t.viewer.isLeader && <TeamSettings team={t} />}
        <ActivityLog teamId={t.id} />
        <LeavePanel team={t} slug={hackathon.slug} />
      </div>
    </div>
  );
}

function InviteCard({ team: t }: { team: TeamDetail }) {
  const { toast } = useAnnounce();
  const regen = useNewInvite(t.id);
  const [ttl, setTtl] = useState(48);
  const [maxUses, setMaxUses] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const inv = t.invite;
  const link = inv ? `${location.origin}/join/${formatInviteCode(inv.code)}` : '';

  async function copy(what: 'code' | 'link') {
    if (!inv) return;
    await navigator.clipboard.writeText(what === 'code' ? formatInviteCode(inv.code) : link);
    setCopied(what);
    toast({ tone: 'success', title: what === 'code' ? 'Invite code copied' : 'Invite link copied' });
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <Panel title="Invite code">
      {inv ? (
        <div className={team.ticket}>
          <div className={team.ticketMain}>
            <p className={`code ${team.code}`} aria-label={`Invite code ${formatInviteCode(inv.code).split('').join(' ')}`}>
              {formatInviteCode(inv.code)}
            </p>
            <p className={styles.muted}>
              Expires in {expiresIn(inv.expiresAt)}. {inv.maxUses ? `${inv.maxUses - inv.uses} of ${inv.maxUses} uses left.` : `Used ${inv.uses} ${inv.uses === 1 ? 'time' : 'times'}.`}
            </p>
          </div>
          <div className={team.ticketActions}>
            <Button size="sm" variant="secondary" icon={copied === 'code' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} onClick={() => void copy('code')}>
              Copy code
            </Button>
            <Button size="sm" variant="secondary" icon={copied === 'link' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} onClick={() => void copy('link')}>
              Copy link
            </Button>
          </div>
        </div>
      ) : (
        <p className={styles.muted}>No active code. Make one to invite people directly.</p>
      )}
      <form
        className={team.regen}
        onSubmit={(e) => {
          e.preventDefault();
          regen.mutate({ ttlHours: ttl, maxUses: maxUses ? Number(maxUses) : null });
        }}
      >
        <Field label="Expires after">
          {(p) => (
            <Select {...p} value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
              {INVITE_TTLS.map((h) => (
                <option key={h} value={h}>
                  {h === 1 ? '1 hour' : h === 168 ? '7 days' : `${h} hours`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Use limit" optional>
          {(p) => (
            <Select {...p} value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
              <option value="">No limit</option>
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'person' : 'people'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="quiet" icon={<RefreshCw size={15} aria-hidden />} busy={regen.isPending}>
          {inv ? 'Replace code' : 'Make a code'}
        </Button>
      </form>
    </Panel>
  );
}

function RequestInbox({ team: t }: { team: TeamDetail }) {
  const { hackathon } = useShell();
  const decide = useDecide(hackathon, t.id);
  const full = t.memberCount >= t.maxSize;
  return (
    <Panel title="Join requests" action={<span className={styles.muted}>{t.requests.length} waiting</span>}>
      {t.requests.length === 0 ? (
        <p className={styles.muted}>No one is waiting. Requests appear here the moment they’re sent.</p>
      ) : (
        <ul className={team.list}>
          {t.requests.map((r) => (
            <li key={r.id} className={team.request}>
              <div className={team.person}>
                <span className={team.plate} style={{ ['--fill' as string]: roleVar(roleOf(r.user.skills)) }} aria-hidden>
                  {initials(r.user.displayName)}
                </span>
                <div>
                  <p className={team.personName}>{r.user.displayName}</p>
                  <p className={styles.muted}>
                    {utc(r.user.utcOffsetMinutes)}, asked {relative(r.createdAt)}
                  </p>
                </div>
              </div>
              <div className={styles.row}>
                {r.user.skills.slice(0, 4).map((s) => (
                  <SkillChip key={s} id={s} />
                ))}
              </div>
              {r.message && <blockquote className={team.message}>{r.message}</blockquote>}
              <div className={styles.row}>
                <Button size="sm" disabled={full} onClick={() => decide.mutate({ requestId: r.id, decision: 'accept', name: r.user.displayName })}>
                  Accept
                </Button>
                <Button size="sm" variant="quiet" onClick={() => decide.mutate({ requestId: r.id, decision: 'decline', name: r.user.displayName })}>
                  Decline
                </Button>
                {full && <span className={styles.muted}>Your team is full</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MemberList({ team: t }: { team: TeamDetail }) {
  const { me, hackathon } = useShell();
  const command = useTeamCommand(hackathon, t.id);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'lead'; id: string; name: string } | null>(null);
  return (
    <Panel title="Members">
      <ul className={team.list}>
        {t.members.map((m) => (
          <li key={m.id} className={team.member}>
            <div className={team.person}>
              <span className={team.plate} style={{ ['--fill' as string]: roleVar(roleOf(m.skills)) }} aria-hidden>
                {initials(m.displayName)}
              </span>
              <div>
                <p className={team.personName}>
                  {m.displayName}
                  {m.id === me.user.id && ' (you)'}
                  {m.isLeader && (
                    <span className={team.leader}>
                      <Crown size={13} aria-hidden /> Leader
                    </span>
                  )}
                </p>
                <p className={styles.muted}>
                  {m.skills.map(skillLabel).join(', ') || 'No skills listed'}. {localTime(m.utcOffsetMinutes)} for them now.
                </p>
              </div>
            </div>
            {t.viewer.isLeader && m.id !== me.user.id && (
              <div className={styles.row}>
                <Button size="sm" variant="quiet" onClick={() => setConfirm({ kind: 'lead', id: m.id, name: m.displayName })}>
                  Make leader
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'remove', id: m.id, name: m.displayName })}>
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'remove' ? `Remove ${confirm?.name}?` : `Make ${confirm?.name} the leader?`}
        description={
          confirm?.kind === 'remove'
            ? 'They lose their seat right away and get notified. This is recorded in the activity log.'
            : 'They’ll manage requests and the invite code. You stay on the team as a member.'
        }
      >
        <ModalActions>
          <Button variant="quiet" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant={confirm?.kind === 'remove' ? 'danger' : 'primary'}
            busy={command.isPending}
            onClick={() => {
              if (!confirm) return;
              const c = confirm;
              command.mutate(
                c.kind === 'remove'
                  ? { path: `/members/${c.id}/remove`, success: `${c.name} was removed` }
                  : { path: '/leader', body: { userId: c.id }, success: `${c.name} now leads the team` },
                { onSettled: () => setConfirm(null) },
              );
            }}
          >
            {confirm?.kind === 'remove' ? 'Remove from team' : 'Make leader'}
          </Button>
        </ModalActions>
      </Modal>
    </Panel>
  );
}

function TeamSettings({ team: t }: { team: TeamDetail }) {
  const { hackathon } = useShell();
  const qc = useQueryClient();
  const { toast } = useAnnounce();
  const roster = useTeamCommand(hackathon, t.id);
  const [draft, setDraft] = useState({ name: t.name, description: t.description, lookingFor: t.lookingFor, joinPolicy: t.joinPolicy });
  const [version, setVersion] = useState(t.version);
  const [conflict, setConflict] = useState<TeamDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!conflict) setVersion(t.version);
  }, [t.version, conflict]);

  const dirty = draft.name !== t.name || draft.description !== t.description || draft.joinPolicy !== t.joinPolicy || draft.lookingFor.join() !== t.lookingFor.join();

  async function save(e?: FormEvent, expectedVersion = version) {
    e?.preventDefault();
    setBusy(true);
    setErrors({});
    const prev = qc.getQueryData<TeamDetail>(keys.team(t.id));
    // optimistic: the page shows the new details immediately
    if (prev) qc.setQueryData(keys.team(t.id), { ...prev, ...draft });
    try {
      const next = await api.patch<TeamDetail>(`/teams/${t.id}`, { ...draft, expectedVersion }, newKey());
      qc.setQueryData(keys.team(t.id), next);
      setConflict(null);
      setVersion(next.version);
      toast({ tone: 'success', title: 'Team details saved' });
      void qc.invalidateQueries({ queryKey: ['board'] });
    } catch (err) {
      if (prev) qc.setQueryData(keys.team(t.id), prev); // roll back
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setConflict({ ...(prev as TeamDetail), ...(err.details?.team as object) } as TeamDetail);
        setVersion(Number(err.details?.currentVersion));
      } else {
        setErrors(fieldErrors(err));
        if (!(err instanceof ApiError && err.code === 'VALIDATION')) toast({ tone: 'conflict', title: 'Couldn’t save', body: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Team details">
      <form className={styles.formGrid} onSubmit={(e) => void save(e)} noValidate>
        {conflict && (
          <div className={team.conflict} role="alert">
            <p>
              <strong>The team changed while you were editing</strong> (someone joined or left, or another device saved). Your edits are still here.
            </p>
            <div className={styles.row}>
              <Button size="sm" onClick={() => void save(undefined, version)}>
                Save my edits anyway
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  setDraft({ name: conflict.name, description: conflict.description, lookingFor: conflict.lookingFor, joinPolicy: conflict.joinPolicy });
                  setConflict(null);
                }}
              >
                Use the latest version
              </Button>
            </div>
          </div>
        )}
        <Field label="Team name" error={errors.name}>
          {(p) => <Input {...p} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={40} />}
        </Field>
        <Field label="Pitch" optional error={errors.description}>
          {(p) => <Textarea {...p} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={280} />}
        </Field>
        <Field label="How people join">
          {(p) => (
            <Select {...p} value={draft.joinPolicy} onChange={(e) => setDraft({ ...draft, joinPolicy: e.target.value as 'open' | 'approval' })}>
              <option value="approval">Approval: I accept each person</option>
              <option value="open">Open: first come, first seated</option>
            </Select>
          )}
        </Field>
        <SkillPicker legend="Skills you’re looking for" value={draft.lookingFor} onChange={(v) => setDraft({ ...draft, lookingFor: v })} max={8} optional />
        <div className={styles.row}>
          <Button type="submit" busy={busy} disabled={!dirty}>
            Save details
          </Button>
          <Button
            variant="secondary"
            busy={roster.isPending}
            disabled={!t.rosterLocked && t.memberCount < t.minSize}
            onClick={() => roster.mutate({ path: '/roster', body: { locked: !t.rosterLocked }, success: t.rosterLocked ? 'Roster unlocked' : 'Roster locked' })}
          >
            {t.rosterLocked ? 'Unlock roster' : 'Lock roster'}
          </Button>
          {!t.rosterLocked && t.memberCount < t.minSize && <span className={styles.muted}>Lock needs {t.minSize} members</span>}
        </div>
      </form>
    </Panel>
  );
}

const ACTION_TEXT: Record<string, (e: AuditEntryView) => string> = {
  'team.created': (e) => `${e.actor?.displayName ?? 'Someone'} created the team`,
  'team.updated': (e) => `${e.actor?.displayName ?? 'Someone'} edited ${(e.details.changes as string[] | undefined)?.join(', ') ?? 'the details'}`,
  'team.deleted': () => 'The team was disbanded',
  'member.joined': (e) => `${e.subject?.displayName ?? 'Someone'} joined${e.details.via === 'code' ? ' with the invite code' : e.details.via === 'request' ? ' (request accepted)' : e.details.via === 'open' ? ' (open seat)' : ''}`,
  'member.left': (e) => `${e.subject?.displayName ?? 'Someone'} left`,
  'member.removed': (e) => `${e.actor?.displayName ?? 'The leader'} removed ${e.subject?.displayName ?? 'a member'}`,
  'leader.changed': (e) => `${e.subject?.displayName ?? 'Someone'} became leader${e.details.reason === 'previous leader left' ? ' after the leader left' : ''}`,
  'roster.locked': (e) => `${e.actor?.displayName ?? 'The leader'} locked the roster`,
  'roster.unlocked': (e) => (e.actor ? `${e.actor.displayName} unlocked the roster` : 'Roster unlocked: the team dropped below the minimum'),
  'request.created': (e) => `${e.actor?.displayName ?? 'Someone'} asked to join`,
  'request.accepted': (e) => `${e.actor?.displayName ?? 'The leader'} accepted ${e.subject?.displayName ?? 'a request'}`,
  'request.declined': (e) => `${e.actor?.displayName ?? 'The leader'} declined ${e.subject?.displayName ?? 'a request'}`,
  'request.cancelled': (e) => `${e.actor?.displayName ?? 'Someone'} withdrew their request`,
  'invite.created': (e) => `${e.actor?.displayName ?? 'The leader'} made a new invite code`,
  'invite.revoked': (e) => `${e.actor?.displayName ?? 'The leader'} revoked the invite code`,
};

function ActivityLog({ teamId }: { teamId: string }) {
  const audit = useAudit(teamId, true);
  const items = audit.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Panel title="Activity">
      {audit.isLoading && <Spinner label="Loading activity" />}
      <ol className={team.timeline}>
        {items.map((e) => (
          <li key={e.id}>
            <span className={team.when}>
              <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>
                {relative(e.createdAt)}
              </time>
            </span>
            <span>{(ACTION_TEXT[e.action] ?? ((x: AuditEntryView) => x.action))(e)}</span>
          </li>
        ))}
      </ol>
      {audit.hasNextPage && (
        <Button size="sm" variant="quiet" busy={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
          Show older activity
        </Button>
      )}
    </Panel>
  );
}

function LeavePanel({ team: t, slug }: { team: TeamDetail; slug: string }) {
  const { hackathon, me } = useShell();
  const leave = useLeave(hackathon, t.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const last = t.memberCount === 1;
  const successor = t.members.filter((m) => m.id !== me.user.id)[0];
  const consequence = last
    ? 'You’re the last member, so the team will be disbanded. Its history stays in the audit log.'
    : t.viewer.isLeader
      ? `${successor?.displayName ?? 'The longest-serving member'} becomes leader, since they’ve been on the team longest.`
      : 'Your seat opens up for someone else.';
  return (
    <Panel title="Leave team">
      <p className={styles.muted}>{consequence}</p>
      <div style={{ marginTop: 'var(--s-4)' }}>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Leave {t.name}
        </Button>
      </div>
      <Modal open={open} onOpenChange={setOpen} title={`Leave ${t.name}?`} description={consequence}>
        <ModalActions>
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Stay
          </Button>
          <Button variant="danger" busy={leave.isPending} onClick={() => leave.mutate(undefined, { onSuccess: () => navigate(`/h/${slug}`) })}>
            {last ? 'Leave and disband' : 'Leave team'}
          </Button>
        </ModalActions>
      </Modal>
    </Panel>
  );
}

export { EmptyState };
