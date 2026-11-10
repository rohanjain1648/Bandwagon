import { DEMO_HACKATHON_SLUG, SKILLS, utcOffsetOf, type Role } from '@bw/shared';
import { hash } from '@node-rs/argon2';
import type { Sql, Tx } from '../db/pool';
import { generateInviteCode } from '../lib/inviteCode';

export interface SeedOptions {
  users: number;
  teams: number;
  seed?: number;
  log?: (msg: string) => void;
}

export const DEMO_PASSWORD = 'hackathon';

// ── deterministic randomness ───────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Aanya', 'Mateo', 'Ife', 'Wen', 'Lukas', 'Priya', 'Kofi', 'Sofia', 'Hiro', 'Zara', 'Omar', 'Lena', 'Diego', 'Mei', 'Arjun', 'Noa', 'Tariq', 'Elif', 'Jonas', 'Amara', 'Ravi', 'Chloe', 'Kwame', 'Yuki', 'Ines', 'Sami', 'Freya', 'Bilal', 'Hana', 'Theo', 'Nia', 'Rohan', 'Ayla', 'Felix', 'Leila', 'Kai', 'Maya', 'Emeka', 'Sana', 'Luca', 'Isha', 'Tomás', 'Aiko', 'Malik', 'Nora', 'Dev', 'Esi', 'Viktor', 'Lin', 'Pablo', 'Anika', 'Joon', 'Rosa', 'Kiran', 'Ola', 'Mira', 'Yusuf', 'Clara', 'Ade', 'Tara'];
const LAST = ['Rao', 'Ruiz', 'Okafor', 'Li', 'Becker', 'Sharma', 'Mensah', 'Rossi', 'Tanaka', 'Khan', 'Haddad', 'Novak', 'Silva', 'Chen', 'Iyer', 'Levi', 'Aziz', 'Yilmaz', 'Berg', 'Nwosu', 'Patel', 'Martin', 'Asante', 'Sato', 'Costa', 'Nasser', 'Larsen', 'Qureshi', 'Kim', 'Dubois', 'Adeyemi', 'Jain', 'Demir', 'Wagner', 'Farah', 'Nakamura', 'Lopez', 'Eze', 'Malik', 'Bianchi', 'Menon', 'García', 'Ito', 'Diallo', 'Holm', 'Kapoor', 'Owusu', 'Petrov', 'Zhang', 'Moreno', 'Bose', 'Park', 'Herrera', 'Reddy', 'Bakare', 'Fischer', 'Hassan', 'Lund', 'Achebe', 'Verma'];
const ADJ = ['Night Shift', 'Quiet', 'Paper', 'Tide', 'Copper', 'Velvet', 'Signal', 'Neon', 'Lucky', 'Feral', 'Sunday', 'Static', 'Pocket', 'Brave', 'Hollow', 'Orbit', 'Ember', 'Glass', 'Rapid', 'Second', 'Solar', 'Cosmic', 'Tiny', 'Wild', 'Late', 'Open', 'Hidden', 'Bright', 'Mellow', 'Rogue', 'Silent', 'Fuzzy', 'Electric', 'Gentle', 'Lunar', 'Plain', 'Rusty', 'Sharp', 'Golden', 'Kind', 'Loud', 'Northern', 'Odd', 'Salty', 'Spare', 'Stray', 'True', 'Upside', 'Warm', 'Zero'];
const NOUN = ['Labs', 'Compute', 'Planes', 'Pool', 'Kettle', 'Owls', 'Garden', 'Circuit', 'Foxes', 'Lantern', 'Engine', 'Collective', 'Atlas', 'Harbor', 'Ferns', 'Pixels', 'Robots', 'Studio', 'Crew', 'Signals', 'Commit', 'Wagon', 'Rockets', 'Workshop', 'Thread', 'Beacons', 'Coders', 'Makers', 'Notebook', 'Sparks', 'Orchard', 'Relay', 'Static', 'Tigers', 'Bureau', 'Cartel', 'Quarry', 'Drifters', 'Loop', 'Mosaic', 'Nomads', 'Parcel', 'Radar', 'Saplings', 'Society', 'Syndicate', 'Tandem', 'Unit', 'Vault', 'Yard'];
const PITCHES = [
  'Realtime transit alerts for commuters with low vision.',
  'Carbon-aware job scheduler for student clusters.',
  'Hindi-first voice notes that become pull requests.',
  'Ocean-sensor data viz for classrooms.',
  'Offline-first field notes for NGOs.',
  'Peer code review that rewards kindness.',
  'A study-group matcher that respects time zones.',
  'Accessible maps of step-free routes on campus.',
  'LLM tutor that explains its own mistakes.',
  'Food-bank inventory that works over SMS.',
  'Wildfire smoke forecasts for outdoor workers.',
  'A budget app for first-time renters.',
  'Sign-language practice with on-device vision.',
  'Open-source tool to audit cookie banners.',
  'Bike-lane pothole reports with one photo.',
  'Volunteer shift swaps without a group chat.',
  'Mental-health check-ins for night-shift staff.',
  'Local-first notes that sync over Bluetooth.',
  'Recipe scaler that understands pantry leftovers.',
  'Library seat finder with live occupancy.',
  'Game that teaches SQL through heists.',
  'Plant-disease spotter for balcony gardens.',
  'Captioning for live lectures in 12 languages.',
  'A friendlier dashboard for city air quality.',
  'Kids’ coding puzzles that run on old phones.',
  'Open dataset of public drinking fountains.',
  'Price tracker for textbooks across campuses.',
  'Quiet-hours bot for noisy group chats.',
  'Lost-and-found that matches photos to reports.',
  'Mesh-network chat for festival grounds.',
];

const ROLE_WEIGHTS: Array<[Role, number]> = [
  ['frontend', 28],
  ['backend', 25],
  ['data', 15],
  ['design', 12],
  ['mobile', 10],
  ['infra', 10],
];
const TIMEZONES: Array<[string, number]> = [
  ['Asia/Kolkata', 25],
  ['America/New_York', 11],
  ['Europe/London', 8],
  ['Europe/Berlin', 8],
  ['America/Los_Angeles', 7],
  ['America/Sao_Paulo', 5],
  ['Africa/Lagos', 5],
  ['Asia/Singapore', 5],
  ['Asia/Dubai', 4],
  ['Europe/Warsaw', 4],
  ['America/Chicago', 4],
  ['Asia/Tokyo', 4],
  ['Australia/Sydney', 3],
  ['Asia/Kathmandu', 2],
  ['Pacific/Auckland', 2],
  ['America/St_Johns', 1],
];
const HOURS: Array<[number, number, number]> = [
  [9, 22, 50],
  [10, 23, 20],
  [8, 18, 15],
  [14, 2, 10],
  [6, 14, 5],
];

function weighted<T>(rnd: () => number, items: Array<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [item, w] of items) {
    x -= w;
    if (x <= 0) return item;
  }
  return items[items.length - 1]![0];
}

function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.floor(rnd() * list.length)]!;
}

function shuffle<T>(rnd: () => number, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

const SKILLS_BY_ROLE = new Map<Role, string[]>();
for (const s of SKILLS) SKILLS_BY_ROLE.set(s.role, [...(SKILLS_BY_ROLE.get(s.role) ?? []), s.id]);

function skillsFor(rnd: () => number): string[] {
  const primary = weighted(rnd, ROLE_WEIGHTS);
  const own = shuffle(rnd, [...SKILLS_BY_ROLE.get(primary)!]).slice(0, 2 + Math.floor(rnd() * 3));
  const extras = Math.floor(rnd() * 3);
  for (let i = 0; i < extras; i++) own.push(pick(rnd, SKILLS).id);
  return [...new Set(own)].slice(0, 6);
}

async function insertChunked(tx: Tx, table: string, rows: Record<string, unknown>[], returning = false) {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    if (returning) {
      out.push(...(await tx`INSERT INTO ${tx(table)} ${tx(chunk as never)} RETURNING id`));
    } else {
      await tx`INSERT INTO ${tx(table)} ${tx(chunk as never)}`;
    }
  }
  return out as Array<{ id: string }>;
}

export async function runSeed(sql: Sql, opts: SeedOptions): Promise<{ hackathonId: string; users: number; teams: number; ms: number }> {
  const log = opts.log ?? (() => {});
  const rnd = mulberry32(opts.seed ?? 20261110);
  const t0 = Date.now();
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const now = Date.now();

  const result = await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as Tx;
    const [h] = await tx<{ id: string; min_team_size: number; max_team_size: number }[]>`
      INSERT INTO hackathons (slug, name, min_team_size, max_team_size)
      VALUES (${DEMO_HACKATHON_SLUG}, 'Hack4Hack 2026', 2, 4)
      RETURNING id, min_team_size, max_team_size`;
    const hackathonId = h!.id;
    const maxSize = h!.max_team_size;

    // ── users ───────────────────────────────────────────────────────────
    const LEADERS = 30;
    const SOLOS = 30;
    const users = Array.from({ length: opts.users }, (_, i) => {
      const tz = weighted(rnd, TIMEZONES);
      const [ws, we] = weighted(rnd, HOURS.map(([a, b, w]) => [[a, b] as const, w]));
      const persona = i < LEADERS ? 'leader' : i < LEADERS + SOLOS ? 'solo' : i === LEADERS + SOLOS ? 'organizer' : null;
      const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
      return {
        email:
          persona === 'leader' ? `leader${i + 1}@demo.bandwagon.dev`
          : persona === 'solo' ? `solo${i - LEADERS + 1}@demo.bandwagon.dev`
          : persona === 'organizer' ? 'organizer@demo.bandwagon.dev'
          : `user${i + 1}@demo.bandwagon.dev`,
        password_hash: passwordHash,
        display_name: name,
        bio: '',
        skills: skillsFor(rnd),
        timezone: tz,
        utc_offset_minutes: utcOffsetOf(tz) ?? 0,
        work_start_hour: ws,
        work_end_hour: we,
        role: persona === 'organizer' ? 'organizer' : 'participant',
        is_demo: true,
        demo_persona: persona,
        created_at: new Date(now - (8 * 24 * 3600 * 1000) * (1 - i / opts.users)),
      };
    });
    const userIds = (await insertChunked(tx, 'users', users, true)).map((r) => r.id);
    log(`users: ${userIds.length}`);

    // ── registration ────────────────────────────────────────────────────
    const regTimes = userIds.map((_, i) => new Date(now - 7 * 24 * 3600 * 1000 * (1 - i / userIds.length) - Math.floor(rnd() * 3600_000)));
    await insertChunked(
      tx,
      'participants',
      userIds.map((id, i) => ({ hackathon_id: hackathonId, user_id: id, looking_for_team: rnd() < 0.85, registered_at: regTimes[i] })),
    );

    // ── teams ───────────────────────────────────────────────────────────
    const leaderPersonas = userIds.slice(0, LEADERS);
    const reserved = new Set(userIds.slice(0, LEADERS + SOLOS + 1));
    const pool = shuffle(rnd, userIds.filter((id) => !reserved.has(id)));
    let cursor = 0;
    const take = () => pool[cursor++]!;

    const names = shuffle(rnd, ADJ.flatMap((a) => NOUN.map((n) => `${a} ${n}`)));
    const teams: Array<{ leader: string; members: string[]; created: Date; row: Record<string, unknown> }> = [];
    for (let i = 0; i < opts.teams; i++) {
      const isPersona = i < LEADERS;
      const size = isPersona ? maxSize - 1 : weighted(rnd, [[1, 25], [2, 30], [3, 30], [maxSize, 15]] as Array<[number, number]>);
      const leader = isPersona ? leaderPersonas[i]! : take();
      const members = [leader];
      for (let k = 1; k < size && cursor < pool.length; k++) members.push(take());
      const created = new Date(now - Math.floor(rnd() * 6 * 24 * 3600 * 1000) - 3600_000);
      const looking = shuffle(rnd, [...SKILLS].map((s) => s.id)).slice(0, 1 + Math.floor(rnd() * 3));
      teams.push({
        leader,
        members,
        created,
        row: {
          hackathon_id: hackathonId,
          name: names[i] ?? `Team ${i + 1}`,
          description: pick(rnd, PITCHES),
          looking_for: looking,
          join_policy: isPersona ? 'approval' : rnd() < 0.3 ? 'open' : 'approval',
          leader_id: leader,
          min_size: h!.min_team_size,
          max_size: maxSize,
          created_at: created,
          updated_at: created,
        },
      });
    }
    const teamIds = (await insertChunked(tx, 'teams', teams.map((t) => t.row), true)).map((r) => r.id);
    log(`teams: ${teamIds.length}`);

    // Seat members (the trigger keeps member_count and skills exact; the leader FK is checked at commit).
    const seats: Array<[string, string, Date]> = [];
    teams.forEach((t, i) => {
      t.members.forEach((m, k) => seats.push([m, teamIds[i]!, new Date(t.created.getTime() + k * 3_600_000 * (0.5 + rnd()))]));
    });
    for (let i = 0; i < seats.length; i += 1000) {
      const chunk = seats.slice(i, i + 1000).map(([u, t, d]) => [u, t, d.toISOString()]);
      await tx`
        UPDATE participants p SET team_id = v.team_id::uuid, team_joined_at = v.joined::timestamptz
          FROM (VALUES ${tx(chunk as never)}) AS v (user_id, team_id, joined)
         WHERE p.hackathon_id = ${hackathonId} AND p.user_id = v.user_id::uuid`;
    }
    log(`seats taken: ${seats.length}`);

    // ── invite codes ────────────────────────────────────────────────────
    await insertChunked(
      tx,
      'invite_codes',
      teamIds.map((id, i) => ({
        team_id: id,
        code: generateInviteCode(),
        created_by: teams[i]!.leader,
        expires_at: new Date(now + 7 * 24 * 3600 * 1000),
      })),
    );

    // ── pending join requests ───────────────────────────────────────────
    const seated = new Set(seats.map(([u]) => u));
    const solos = pool.filter((id) => !seated.has(id));
    const openApproval = teamIds
      .map((id, i) => ({ id, t: teams[i]! }))
      .filter(({ t }) => t.members.length < maxSize && t.row.join_policy === 'approval');
    const requests: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const addRequest = (teamId: string, userId: string, message: string) => {
      const key = `${teamId}:${userId}`;
      if (seen.has(key)) return;
      seen.add(key);
      requests.push({ team_id: teamId, hackathon_id: hackathonId, user_id: userId, message, created_at: new Date(now - Math.floor(rnd() * 48 * 3600_000)) });
    };
    // every persona leader has two people waiting in their inbox
    for (let i = 0; i < LEADERS; i++) {
      addRequest(teamIds[i]!, solos[(i * 2) % solos.length]!, 'I can take the backend so you can focus on the demo.');
      addRequest(teamIds[i]!, solos[(i * 2 + 1) % solos.length]!, '');
    }
    for (const userId of solos.slice(LEADERS * 2)) {
      if (rnd() > 0.35) continue;
      const n = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < n; k++) addRequest(pick(rnd, openApproval).id, userId, rnd() < 0.4 ? 'Would love to help, here’s my GitHub.' : '');
    }
    await insertChunked(tx, 'join_requests', requests);
    log(`pending requests: ${requests.length}`);

    // ── history ─────────────────────────────────────────────────────────
    const auditRows: Record<string, unknown>[] = [];
    teams.forEach((t, i) => {
      auditRows.push({ hackathon_id: hackathonId, team_id: teamIds[i], team_name: t.row.name, actor_id: t.leader, action: 'team.created', details: { seeded: true }, created_at: t.created });
    });
    for (const [u, teamId, joined] of seats) {
      const t = teams[teamIds.indexOf(teamId)]!;
      auditRows.push({ hackathon_id: hackathonId, team_id: teamId, team_name: t.row.name, actor_id: u, subject_id: u, action: 'member.joined', details: { via: u === t.leader ? 'create' : 'seed', seeded: true }, created_at: joined });
    }
    await insertChunked(tx, 'audit_log', auditRows);

    // ── race-arena bots (hidden from the people board) ──────────────────
    const bots = Array.from({ length: 60 }, (_, i) => ({
      email: `bot${i + 1}@bots.bandwagon.dev`,
      password_hash: 'not-a-login',
      display_name: `${pick(rnd, FIRST)} Bot ${String(i + 1).padStart(2, '0')}`,
      skills: ['typescript'],
      timezone: 'UTC',
      utc_offset_minutes: 0,
      is_demo: true,
      demo_persona: 'bot',
    }));
    const botIds = (await insertChunked(tx, 'users', bots, true)).map((r) => r.id);
    await insertChunked(tx, 'participants', botIds.map((id) => ({ hackathon_id: hackathonId, user_id: id, looking_for_team: false })));

    return { hackathonId, users: userIds.length, teams: teamIds.length };
  });

  const [{ n }] = (await sql`SELECT count(*)::int AS n FROM bw_check_invariants()`) as unknown as [{ n: number }];
  if (n > 0) throw new Error(`seed produced ${n} invariant violations`);
  const ms = Date.now() - t0;
  log(`seed complete in ${ms} ms, invariants clean`);
  return { ...result, ms };
}

export async function seedIfEmpty(sql: Sql, log: (m: string) => void = () => {}, opts: Partial<SeedOptions> = {}) {
  const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM hackathons`;
  if ((row?.n ?? 0) > 0) return null;
  log('empty database: seeding demo data (10,000 users, 2,000 teams)…');
  return runSeed(sql, { users: 10_000, teams: 2_000, log, ...opts });
}
