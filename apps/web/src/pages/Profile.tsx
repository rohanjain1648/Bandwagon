import { DEMO_HACKATHON_SLUG, type HackathonView, type MeView } from '@bw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/Shell';
import { Button, ErrorNote, Field, Input, Panel, Select, Spinner, Textarea } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { api, errorMessage, fieldErrors, newKey } from '../lib/api';
import { keys, useMe } from '../lib/queries';
import { SkillPicker } from './MyTeam';
import auth from './auth.module.css';
import styles from './pages.module.css';

export function ProfilePage() {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <p className={styles.muted}>Signed out. <Link to="/login">Sign in</Link></p>;
  return <ProfileForm me={me.data} />;
}

function ProfileForm({ me }: { me: MeView }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useAnnounce();
  const u = me.user;
  const [form, setForm] = useState({ displayName: u.displayName, bio: u.bio, timezone: u.timezone, workStartHour: u.workStartHour, workEndHour: u.workEndHour, skills: u.skills });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return [u.timezone];
    }
  }, [u.timezone]);
  const slug = me.hackathons[0]?.slug ?? DEMO_HACKATHON_SLUG;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const next = await api.patch<MeView>('/me', form, newKey());
      qc.setQueryData(keys.me, next);
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      toast({ tone: 'success', title: 'Profile saved', body: 'Your card updates on the board for everyone.' });
    } catch (err) {
      setErrors(fieldErrors(err));
      if (!Object.keys(fieldErrors(err)).length) toast({ tone: 'conflict', title: 'Couldn’t save', body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleLooking(h: MeView['hackathons'][number]) {
    try {
      await api.patch<HackathonView>(`/hackathons/${h.id}/me`, { lookingForTeam: !h.lookingForTeam }, newKey());
      await qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.hackathon(h.slug) });
    } catch (err) {
      toast({ tone: 'conflict', title: 'Couldn’t update', body: errorMessage(err) });
    }
  }

  async function logout() {
    await api.post('/auth/logout').catch(() => {});
    qc.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className={auth.screen}>
      <div className={auth.brandRow}>
        <Link to={`/h/${slug}`} style={{ textDecoration: 'none' }}>
          <Wordmark inverted={false} />
        </Link>
      </div>
      <main id="main" className={`${styles.page} ${styles.narrow}`} style={{ width: '100%' }}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.title}>Your card</h1>
            <p className={styles.lede}>This is what leaders see when you ask to join, and what the suggestions score.</p>
          </div>
          <div className={styles.row}>
            <Link to={`/h/${slug}`}>Back to the board</Link>
            <Button variant="quiet" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </header>
        <div className={styles.twoUp}>
          <Panel title="Profile">
            <form className={styles.formGrid} onSubmit={save} noValidate>
              <Field label="Name" error={errors.displayName}>
                {(p) => <Input {...p} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={60} />}
              </Field>
              <Field label="About you" optional error={errors.bio} hint="One or two lines. What you like building.">
                {(p) => <Textarea {...p} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={280} />}
              </Field>
              <Field label="Time zone" error={errors.timezone}>
                {(p) => (
                  <Select {...p} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className={styles.twoUp}>
                <Field label="Start">
                  {(p) => (
                    <Select {...p} value={form.workStartHour} onChange={(e) => setForm({ ...form, workStartHour: Number(e.target.value) })}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, '0')}:00
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Stop">
                  {(p) => (
                    <Select {...p} value={form.workEndHour} onChange={(e) => setForm({ ...form, workEndHour: Number(e.target.value) })}>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, '0')}:00
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <SkillPicker legend="Skills" value={form.skills} onChange={(skills) => setForm({ ...form, skills })} max={12} />
              {errors.skills && <ErrorNote>{errors.skills}</ErrorNote>}
              <Button type="submit" busy={busy}>
                Save profile
              </Button>
            </form>
          </Panel>
          <Panel title="Hackathons">
            <ul className={styles.formGrid} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {me.hackathons.map((h) => (
                <li key={h.id} className={styles.formGrid} style={{ gap: 'var(--s-2)' }}>
                  <Link to={`/h/${h.slug}`} style={{ fontWeight: 800 }}>
                    {h.name}
                  </Link>
                  <p className={styles.muted}>{h.teamId ? 'You’re on a team.' : h.lookingForTeam ? 'You’re listed as looking for a team.' : 'You’re hidden from the people board.'}</p>
                  {!h.teamId && (
                    <div>
                      <Button size="sm" variant="secondary" onClick={() => void toggleLooking(h)}>
                        {h.lookingForTeam ? 'Hide me from the people board' : 'List me as looking'}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </main>
    </div>
  );
}
