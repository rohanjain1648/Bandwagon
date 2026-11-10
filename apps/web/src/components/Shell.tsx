import type { HackathonView, MeView } from '@bw/shared';
import { Inbox, LayoutGrid, Sparkles, Swords, User, Users } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams, Navigate } from 'react-router-dom';
import type { TeamSnapshot } from '@bw/shared';
import { useLiveEvents, type LiveStatus } from '../lib/live';
import { useHackathon, useMe, useMyRequests, useTeam } from '../lib/queries';
import { initials, roleOf, roleVar, utc } from '../lib/format';
import { Spinner, SkillChip } from './ui';
import styles from './Shell.module.css';

interface ShellCtx {
  me: MeView;
  hackathon: HackathonView;
  live: LiveStatus;
  newTeams: TeamSnapshot[];
  clearNewTeams: () => void;
}

const Ctx = createContext<ShellCtx | null>(null);
export function useShell(): ShellCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside AppShell');
  return v;
}

export function Wordmark({ inverted = true }: { inverted?: boolean }) {
  return (
    <span className={styles.wordmark} data-inverted={inverted ? '' : undefined}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect x="3" y="7" width="7" height="18" rx="2" fill="currentColor" />
        <rect x="12.5" y="7" width="7" height="18" rx="2" fill="currentColor" />
        <rect x="22" y="7" width="7" height="18" rx="2" fill="none" stroke="var(--foil)" strokeWidth="2" strokeDasharray="3 2" />
      </svg>
      Bandwagon
    </span>
  );
}

export function AppShell() {
  const { slug = '' } = useParams();
  const me = useMe();
  const hackathon = useHackathon(slug);
  const location = useLocation();
  const [newTeams, setNewTeams] = useState<TeamSnapshot[]>([]);
  const live = useLiveEvents(hackathon.data?.id, (teams) => setNewTeams((prev) => [...prev, ...teams.filter((t) => !prev.some((p) => p.id === t.id))]));
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page heading on navigation so keyboard and screen-reader users land in context.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h1 = mainRef.current?.querySelector('h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: false });
    }
  }, [location.pathname]);

  if (me.isLoading || hackathon.isLoading) return <Spinner label="Opening the board" />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!hackathon.data) return <Navigate to="/" replace />;

  return (
    <Ctx.Provider value={{ me: me.data, hackathon: hackathon.data, live, newTeams, clearNewTeams: () => setNewTeams([]) }}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className={styles.frame}>
        <Rail me={me.data} hackathon={hackathon.data} live={live} />
        <TopBar hackathon={hackathon.data} live={live} />
        <main id="main" ref={mainRef} className={styles.main} tabIndex={-1}>
          <Outlet />
        </main>
        <TabBar slug={slug} />
      </div>
    </Ctx.Provider>
  );
}

function useNavCounts(hackathon: HackathonView) {
  const teamId = hackathon.me?.teamId ?? null;
  const team = useTeam(teamId);
  const mine = useMyRequests(hackathon.id);
  const incoming = team.data?.viewer.isLeader ? team.data.requests.length : 0;
  const outgoing = mine.data?.items.filter((r) => r.status === 'pending').length ?? 0;
  return { incoming, outgoing, teamName: team.data?.name };
}

function Rail({ me, hackathon, live }: { me: MeView; hackathon: HackathonView; live: LiveStatus }) {
  const { incoming, outgoing, teamName } = useNavCounts(hackathon);
  const base = `/h/${hackathon.slug}`;
  const role = roleOf(me.user.skills);
  return (
    <nav className={`${styles.rail} on-shell`} aria-label="Main">
      <Link to={base} className={styles.brand}>
        <Wordmark />
        <span className={styles.event}>{hackathon.name}</span>
      </Link>
      <ul className={styles.nav}>
        <NavItem to={base} end icon={<LayoutGrid size={18} aria-hidden />} label="Board" count={hackathon.stats.openTeams} countLabel="teams with open seats" />
        <NavItem to={`${base}/team`} icon={<Users size={18} aria-hidden />} label="My team" detail={teamName} />
        <NavItem
          to={`${base}/requests`}
          icon={<Inbox size={18} aria-hidden />}
          label="Requests"
          count={incoming || outgoing || undefined}
          countLabel={incoming ? 'people waiting for your answer' : 'pending requests you sent'}
          hot={incoming > 0}
        />
        <NavItem to={`${base}/for-you`} icon={<Sparkles size={18} aria-hidden />} label="For you" />
        <NavItem to={`${base}/arena`} icon={<Swords size={18} aria-hidden />} label="Race arena" />
      </ul>
      <LiveDot live={live} />
      <Link to="/me" className={styles.me} aria-label={`Your profile: ${me.user.displayName}`}>
        <span className={styles.mePlate} style={{ ['--fill' as string]: roleVar(role) }} aria-hidden>
          {initials(me.user.displayName)}
        </span>
        <span className={styles.meBody}>
          <span className={styles.meName}>{me.user.displayName}</span>
          <span className={styles.meMeta}>{utc(me.user.utcOffsetMinutes)}</span>
          <span className={styles.meSkills}>
            {me.user.skills.slice(0, 2).map((s) => (
              <SkillChip key={s} id={s} />
            ))}
          </span>
        </span>
      </Link>
    </nav>
  );
}

function NavItem({ to, icon, label, count, countLabel, detail, end, hot }: { to: string; icon: ReactNode; label: string; count?: number; countLabel?: string; detail?: string; end?: boolean; hot?: boolean }) {
  return (
    <li>
      <NavLink to={to} end={end} className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
        {icon}
        <span className={styles.navText}>
          {label}
          {detail && <span className={styles.navDetail}>{detail}</span>}
        </span>
        {count !== undefined && count > 0 && (
          <span className={styles.count} data-hot={hot ? '' : undefined}>
            {count.toLocaleString()}
            <span className="visually-hidden"> {countLabel}</span>
          </span>
        )}
      </NavLink>
    </li>
  );
}

export function LiveDot({ live, compact }: { live: LiveStatus; compact?: boolean }) {
  const text = live === 'live' ? 'Live' : live === 'reconnecting' ? 'Reconnecting' : 'Connecting';
  return (
    <span className={styles.live} data-state={live} data-compact={compact ? '' : undefined}>
      <span className={styles.dot} aria-hidden />
      {text}
      {!compact && live === 'live' && <span className={styles.liveHint}>Updates arrive without refreshing</span>}
    </span>
  );
}

function TopBar({ hackathon, live }: { hackathon: HackathonView; live: LiveStatus }) {
  return (
    <header className={`${styles.topbar} on-shell`}>
      <Link to={`/h/${hackathon.slug}`} className={styles.brand}>
        <Wordmark />
      </Link>
      <span className={styles.topEvent}>{hackathon.name}</span>
      <LiveDot live={live} compact />
    </header>
  );
}

function TabBar({ slug }: { slug: string }) {
  const base = `/h/${slug}`;
  const items = [
    { to: base, end: true, icon: <LayoutGrid size={20} aria-hidden />, label: 'Board' },
    { to: `${base}/team`, icon: <Users size={20} aria-hidden />, label: 'Team' },
    { to: `${base}/requests`, icon: <Inbox size={20} aria-hidden />, label: 'Requests' },
    { to: `${base}/for-you`, icon: <Sparkles size={20} aria-hidden />, label: 'For you' },
    { to: '/me', icon: <User size={20} aria-hidden />, label: 'Me' },
  ];
  return (
    <nav className={`${styles.tabbar} on-shell`} aria-label="Main">
      <ul>
        {items.map((i) => (
          <li key={i.to}>
            <NavLink to={i.to} end={i.end} className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}>
              {i.icon}
              <span>{i.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
