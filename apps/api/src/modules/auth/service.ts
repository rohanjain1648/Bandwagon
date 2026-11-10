import { hash, verify } from '@node-rs/argon2';
import { utcOffsetOf, type MeView, type ProfilePatch, type SignupBody } from '@bw/shared';
import type { Db } from '../../db/pool';
import { pgCode, pgConstraint } from '../../db/tx';
import { fail } from '../../lib/errors';

// OWASP argon2id baseline: 19 MiB, 2 iterations, 1 lane.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Verified against when the email is unknown, so timing doesn't reveal account existence.
let dummyHash: Promise<string> | null = null;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON);
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string;
  skills: string[];
  timezone: string;
  utc_offset_minutes: number;
  work_start_hour: number;
  work_end_hour: number;
  role: 'participant' | 'organizer';
  is_demo: boolean;
}

export async function createUser(db: Db, input: SignupBody): Promise<UserRow> {
  const offset = utcOffsetOf(input.timezone) ?? 0;
  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db<UserRow[]>`
      INSERT INTO users (email, password_hash, display_name, bio, skills, timezone, utc_offset_minutes, work_start_hour, work_end_hour)
      VALUES (${input.email}, ${passwordHash}, ${input.displayName}, ${input.bio ?? ''}, ${input.skills}, ${input.timezone},
              ${offset}, ${input.workStartHour}, ${input.workEndHour})
      RETURNING *`;
    // Registration is automatic for every hackathon that is still forming teams.
    await db`
      INSERT INTO participants (hackathon_id, user_id)
      SELECT id, ${user!.id} FROM hackathons WHERE formation_closes_at IS NULL OR formation_closes_at > now()
      ON CONFLICT DO NOTHING`;
    return user!;
  } catch (err) {
    if (pgCode(err) === '23505' && pgConstraint(err) === 'users_email_key') fail('EMAIL_TAKEN');
    throw err;
  }
}

export async function checkCredentials(db: Db, email: string, password: string): Promise<UserRow> {
  const [user] = await db<UserRow[]>`SELECT * FROM users WHERE email = ${email}`;
  if (!user) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verify(await dummyHash, password).catch(() => false);
    fail('INVALID_CREDENTIALS');
  }
  const ok = await verify(user.password_hash, password).catch(() => false);
  if (!ok) fail('INVALID_CREDENTIALS');
  return user;
}

export async function getMe(db: Db, userId: string): Promise<MeView | null> {
  const [u] = await db<UserRow[]>`SELECT * FROM users WHERE id = ${userId}`;
  if (!u) return null;
  const hackathons = await db<{ id: string; slug: string; name: string; team_id: string | null; looking_for_team: boolean }[]>`
    SELECT h.id, h.slug, h.name, p.team_id, p.looking_for_team
      FROM participants p JOIN hackathons h ON h.id = p.hackathon_id
     WHERE p.user_id = ${userId}
     ORDER BY h.created_at`;
  return {
    user: {
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      bio: u.bio,
      skills: u.skills,
      timezone: u.timezone,
      utcOffsetMinutes: u.utc_offset_minutes,
      workStartHour: u.work_start_hour,
      workEndHour: u.work_end_hour,
      role: u.role,
      isDemo: u.is_demo,
    },
    hackathons: hackathons.map((h) => ({ id: h.id, slug: h.slug, name: h.name, teamId: h.team_id, lookingForTeam: h.looking_for_team })),
  };
}

export async function updateProfile(db: Db, userId: string, patch: ProfilePatch): Promise<void> {
  const offset = patch.timezone ? utcOffsetOf(patch.timezone) : undefined;
  await db`
    UPDATE users SET
      display_name = COALESCE(${patch.displayName ?? null}, display_name),
      bio = COALESCE(${patch.bio ?? null}, bio),
      skills = COALESCE(${patch.skills ?? null}::text[], skills),
      timezone = COALESCE(${patch.timezone ?? null}, timezone),
      utc_offset_minutes = COALESCE(${offset ?? null}::smallint, utc_offset_minutes),
      work_start_hour = COALESCE(${patch.workStartHour ?? null}::smallint, work_start_hour),
      work_end_hour = COALESCE(${patch.workEndHour ?? null}::smallint, work_end_hour)
    WHERE id = ${userId}`;
}
