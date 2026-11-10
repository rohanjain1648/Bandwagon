import { z } from 'zod';
import { normalizeInviteCode } from './invite';
import { SKILL_IDS, type Role } from './skills';
import { utcOffsetOf } from './tz';

// ── primitives ──────────────────────────────────────────────────────────────

const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Trimmed text without control characters, bounded by code points (so emoji count once). */
export const text = (min: number, max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.replace(CONTROL_CHARS, '').trim())
    .refine((s) => [...s].length >= min, { message: min === 1 ? 'Required' : `At least ${min} characters` })
    .refine((s) => [...s].length <= max, { message: `At most ${max} characters` });

export const uuid = z.string().uuid();
export const skillId = z.enum(SKILL_IDS);
export const skillList = (min: number, max: number) =>
  z
    .array(skillId)
    .min(min, min === 1 ? 'Pick at least one skill' : `Pick at least ${min}`)
    .max(max, `Pick at most ${max}`)
    .transform((list) => [...new Set(list)]);

export const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => utcOffsetOf(tz) !== null, { message: 'Unknown time zone' });

const hour = z.number().int().min(0).max(23);
export const IdParam = z.object({ id: uuid }).strict();

// ── auth & profile ──────────────────────────────────────────────────────────

export const SignupBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8, 'At least 8 characters').max(128),
    displayName: text(1, 60),
    timezone,
    workStartHour: hour.default(9),
    workEndHour: hour.default(22),
    skills: skillList(1, 12),
    bio: text(0, 280).optional(),
  })
  .strict();
export type SignupBody = z.infer<typeof SignupBody>;

export const LoginBody = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const DemoLoginBody = z.object({ persona: z.enum(['leader', 'solo', 'random']).default('random') }).strict();

export const ProfilePatch = z
  .object({
    displayName: text(1, 60),
    bio: text(0, 280),
    timezone,
    workStartHour: hour,
    workEndHour: hour,
    skills: skillList(1, 12),
  })
  .partial()
  .strict();
export type ProfilePatch = z.infer<typeof ProfilePatch>;

export const ParticipantPatch = z.object({ lookingForTeam: z.boolean() }).strict();

// ── teams ───────────────────────────────────────────────────────────────────

export const JOIN_POLICIES = ['open', 'approval'] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

export const CreateTeamBody = z
  .object({
    name: text(2, 40),
    description: text(0, 280).default(''),
    lookingFor: skillList(0, 8).default([]),
    joinPolicy: z.enum(JOIN_POLICIES).default('approval'),
  })
  .strict();
export type CreateTeamBody = z.infer<typeof CreateTeamBody>;

export const PatchTeamBody = z
  .object({
    name: text(2, 40).optional(),
    description: text(0, 280).optional(),
    lookingFor: skillList(0, 8).optional(),
    joinPolicy: z.enum(JOIN_POLICIES).optional(),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
export type PatchTeamBody = z.infer<typeof PatchTeamBody>;

export const RosterBody = z.object({ locked: z.boolean() }).strict();
export const TransferBody = z.object({ userId: uuid }).strict();
export const MemberParams = z.object({ id: uuid, userId: uuid }).strict();

// ── invites ─────────────────────────────────────────────────────────────────

export const INVITE_TTLS = [1, 24, 48, 168] as const;

export const CreateInviteBody = z
  .object({
    ttlHours: z
      .number()
      .int()
      .refine((n) => (INVITE_TTLS as readonly number[]).includes(n), { message: 'Choose 1, 24, 48 or 168 hours' })
      .default(48),
    maxUses: z.number().int().min(1).max(50).nullable().default(null),
  })
  .strict();

export const InviteCode = z
  .string()
  .max(300)
  .transform((s, ctx) => {
    const code = normalizeInviteCode(s);
    if (!code) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invite codes have 12 letters and numbers, like K7QM-4XHT-9RJP' });
      return z.NEVER;
    }
    return code;
  });
export const RedeemBody = z.object({ code: InviteCode }).strict();
export const InviteParams = z.object({ id: uuid, inviteId: uuid }).strict();

// ── join requests ───────────────────────────────────────────────────────────

export const CreateRequestBody = z.object({ message: text(0, 280).default('') }).strict();
export const MAX_PENDING_REQUESTS = 5;

// ── board ───────────────────────────────────────────────────────────────────

const csvSkills = z
  .string()
  .max(200)
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(skillId).max(6));

const boolish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const BoardTeamsQuery = z
  .object({
    q: text(0, 60).optional(),
    skills: csvSkills.optional(),
    tz: z.coerce.number().int().min(0).max(12).optional(),
    policy: z.enum(JOIN_POLICIES).optional(),
    sort: z.enum(['newest', 'filling']).default('newest'),
    includeFull: boolish.default(false),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(24),
  })
  .strict();
export type BoardTeamsQuery = z.infer<typeof BoardTeamsQuery>;

export const BoardPeopleQuery = z
  .object({
    q: text(0, 60).optional(),
    skills: csvSkills.optional(),
    tz: z.coerce.number().int().min(0).max(12).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(24),
  })
  .strict();
export type BoardPeopleQuery = z.infer<typeof BoardPeopleQuery>;

export const LimitQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    cursor: z.string().max(200).optional(),
  })
  .strict();

// ── response shapes ─────────────────────────────────────────────────────────

export interface MemberSnapshot {
  id: string;
  displayName: string;
  skills: string[];
  timezone: string;
  utcOffsetMinutes: number;
  isLeader: boolean;
  joinedAt: string;
}

export interface TeamSnapshot {
  id: string;
  hackathonId: string;
  number: number;
  name: string;
  description: string;
  lookingFor: string[];
  skills: string[];
  joinPolicy: JoinPolicy;
  memberCount: number;
  minSize: number;
  maxSize: number;
  rosterLocked: boolean;
  leaderId: string;
  leaderOffsetMinutes: number;
  members: MemberSnapshot[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonSnapshot {
  id: string;
  displayName: string;
  bio: string;
  skills: string[];
  timezone: string;
  utcOffsetMinutes: number;
  workStartHour: number;
  workEndHour: number;
  registeredAt: string;
}

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface JoinRequestView {
  id: string;
  teamId: string;
  teamName: string;
  teamNumber: number;
  user: PersonSnapshot;
  message: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
}

export interface InviteView {
  id: string;
  code: string;
  expiresAt: string;
  maxUses: number | null;
  uses: number;
  createdAt: string;
}

export interface TeamDetail extends TeamSnapshot {
  viewer: {
    isMember: boolean;
    isLeader: boolean;
    pendingRequestId: string | null;
    onAnotherTeam: boolean;
  };
  invite: InviteView | null;
  requests: JoinRequestView[];
}

export interface InvitePreview {
  team: TeamSnapshot;
  expiresAt: string;
  usesLeft: number | null;
}

export type ScoreKey = 'complement' | 'timezone' | 'novelty';

export interface ScoreComponent {
  key: ScoreKey;
  label: string;
  weight: number;
  value: number;
  points: number;
  reason: string;
}

export interface ScoreBreakdown {
  score: number;
  components: ScoreComponent[];
  matchedSkills: string[];
  newRoles: Role[];
  overlapHours: number;
}

export interface PersonSuggestion extends ScoreBreakdown {
  person: PersonSnapshot;
}

export interface TeamSuggestion extends ScoreBreakdown {
  team: TeamSnapshot;
}

export interface ScoringExplainer {
  formula: string;
  weights: Record<ScoreKey, number>;
  notes: string[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

export interface BoardFrame {
  teams: TeamSnapshot[];
  removed: string[];
  people: PersonSnapshot[];
  peopleRemoved: string[];
  at: string;
}

export type PersonalKind =
  | 'request.created'
  | 'request.decided'
  | 'request.cancelled'
  | 'member.removed'
  | 'member.joined'
  | 'member.left'
  | 'leader.changed'
  | 'team.deleted';

export interface PersonalEvent {
  kind: PersonalKind;
  teamId: string;
  teamName: string;
  requestId?: string;
  status?: RequestStatus;
  actorName?: string;
  subjectName?: string;
}

export interface AuditEntryView {
  id: string;
  action: string;
  actor: { id: string; displayName: string } | null;
  subject: { id: string; displayName: string } | null;
  teamId: string | null;
  teamName: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface HackathonView {
  id: string;
  slug: string;
  name: string;
  minTeamSize: number;
  maxTeamSize: number;
  formationClosesAt: string | null;
  stats: { teams: number; openTeams: number; looking: number; participants: number };
  me: { registered: boolean; teamId: string | null; lookingForTeam: boolean } | null;
}

export interface MeView {
  user: {
    id: string;
    email: string;
    displayName: string;
    bio: string;
    skills: string[];
    timezone: string;
    utcOffsetMinutes: number;
    workStartHour: number;
    workEndHour: number;
    role: 'participant' | 'organizer';
    isDemo: boolean;
  };
  hackathons: Array<{ id: string; slug: string; name: string; teamId: string | null; lookingForTeam: boolean }>;
}

export interface RaceResult {
  teamId: string;
  teamName: string;
  attempts: number;
  winners: number;
  winnerName: string | null;
  outcomes: Record<string, number>;
  invariantViolations: number;
  durationMs: number;
  timeline: Array<{ bot: string; outcome: string; ms: number }>;
  /** the hand right after the race (house bots + the winner) */
  team: TeamSnapshot | null;
  winnerId: string | null;
}
