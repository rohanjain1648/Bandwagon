import { DEMO_HACKATHON_SLUG, type MeView } from '@bw/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SeatSlots } from '../components/SeatSlots';
import { Wordmark } from '../components/Shell';
import { Button, ErrorNote, Field, Input, Select } from '../components/ui';
import { ApiError, api, errorMessage, fieldErrors } from '../lib/api';
import { keys } from '../lib/queries';
import { SkillPicker } from './MyTeam';
import styles from './auth.module.css';
import pages from './pages.module.css';

const DEMO_HAND = [
  { id: 'a', displayName: 'Maya Khan', skills: ['go'], timezone: 'UTC', utcOffsetMinutes: 0, isLeader: true, joinedAt: '' },
  { id: 'b', displayName: 'Leo Silva', skills: ['react'], timezone: 'UTC', utcOffsetMinutes: 0, isLeader: false, joinedAt: '' },
  { id: 'c', displayName: 'Jun Nakamura', skills: ['figma'], timezone: 'UTC', utcOffsetMinutes: 0, isLeader: false, joinedAt: '' },
];

function useAfterAuth() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (me: MeView) => {
    qc.setQueryData(keys.me, me);
    const next = params.get('next');
    const slug = me.hackathons[0]?.slug ?? DEMO_HACKATHON_SLUG;
    navigate(next && next.startsWith('/') ? next : `/h/${slug}`, { replace: true });
  };
}

function AuthFrame({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className={styles.split}>
      <section className={`${styles.story} on-shell`} aria-label="About Bandwagon">
        <Wordmark />
        <div className={styles.storyBody}>
          <p className={styles.storyTitle}>Hundreds of people, one last seat. Exactly one gets it.</p>
          <div className={styles.hand} aria-hidden>
            <SeatSlots members={DEMO_HAND} maxSize={4} />
          </div>
          <ul className={styles.points}>
            <li>A live board of every team with an open seat</li>
            <li>Invite codes, join requests, and suggestions that explain themselves</li>
            <li>Double clicks and flaky Wi-Fi never take two seats</li>
          </ul>
        </div>
        <p className={styles.event}>Hack4Hack 2026, demo data included</p>
      </section>
      <main id="main" className={styles.formSide}>
        <div className={styles.formInner}>
          <h1 className={styles.title}>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const after = useAfterAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'login' | 'leader' | 'solo' | null>(null);
  const [error, setError] = useState('');

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy('login');
    setError('');
    try {
      after((await api.post<{ me: MeView }>('/auth/login', { email, password })).me);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function demo(persona: 'leader' | 'solo') {
    setBusy(persona);
    setError('');
    try {
      after((await api.post<{ me: MeView }>('/auth/demo', { persona })).me);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'NOT_FOUND' ? 'Demo accounts aren’t available on this server.' : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthFrame title="Sign in">
      <div className={styles.demo}>
        <p className={styles.demoLead}>Trying it out? Skip sign-up and play a part.</p>
        <div className={styles.demoButtons}>
          <Button size="lg" busy={busy === 'leader'} onClick={() => void demo('leader')}>
            Lead a team with one seat left
          </Button>
          <Button variant="secondary" size="lg" busy={busy === 'solo'} onClick={() => void demo('solo')}>
            Join as a solo hacker
          </Button>
        </div>
        <p className={styles.hint}>Open both in two browsers to watch seats fill live.</p>
      </div>
      <form className={pages.formGrid} onSubmit={login}>
        <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password">{(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" size="lg" busy={busy === 'login'}>
          Sign in
        </Button>
      </form>
      <p className={styles.switch}>
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </AuthFrame>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function SignupPage() {
  const after = useAfterAuth();
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    workStartHour: 9,
    workEndHour: 22,
    skills: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError('');
    try {
      after((await api.post<{ me: MeView }>('/auth/signup', form)).me);
    } catch (err) {
      const f = fieldErrors(err);
      setErrors(Object.fromEntries(Object.entries(f).map(([k, v]) => [k.split('.')[0]!, v])));
      if (!Object.keys(f).length) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Create your card">
      <form className={pages.formGrid} onSubmit={submit} noValidate>
        <Field label="Name" error={errors.displayName}>
          {(p) => <Input {...p} autoComplete="name" value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} maxLength={60} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <Input {...p} type="email" autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters.">
          {(p) => <Input {...p} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} />}
        </Field>
        <Field label="Time zone" error={errors.timezone} hint="Detected from your browser. Used to match you with people you can actually meet.">
          {(p) => (
            <Select {...p} value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll('_', ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className={pages.twoUp}>
          <Field label="I usually start at">
            {(p) => (
              <Select {...p} value={form.workStartHour} onChange={(e) => set({ workStartHour: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="and stop at">
            {(p) => (
              <Select {...p} value={form.workEndHour} onChange={(e) => set({ workEndHour: Number(e.target.value) })}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <SkillPicker legend="Your skills" value={form.skills} onChange={(skills) => set({ skills })} max={12} />
        {errors.skills && <p className={styles.fieldError}>{errors.skills}</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" size="lg" busy={busy}>
          Create account
        </Button>
      </form>
      <p className={styles.switch}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
