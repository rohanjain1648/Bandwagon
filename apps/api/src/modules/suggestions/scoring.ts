import {
  ROLE_LABELS,
  ROLES,
  groupOverlapHours,
  skillRole,
  rolesOf,
  skillLabel,
  type Role,
  type ScoreBreakdown,
  type ScoreComponent,
  type ScoringExplainer,
  type WorkWindow,
} from '@bw/shared';

export const WEIGHTS = { complement: 50, timezone: 30, novelty: 20 } as const;
export const OVERLAP_CAP_HOURS = 8;

export const SCORING: ScoringExplainer = {
  formula: 'score = 50·Complement + 30·TimeZone + 20·Novelty (each 0–1, so 0–100 overall)',
  weights: { ...WEIGHTS },
  notes: [
    'Complement: share of the skills your team asked for that this person brings (70%), plus new roles they add (30%). Bringing two roles nobody on the team covers earns that part in full. With no wanted skills listed, only new roles count.',
    `Time zone: hours of working-time overlap with the least-overlapping current member (a meeting needs everyone), capped at ${OVERLAP_CAP_HOURS} h.`,
    'Novelty: share of their skills your team does not already have, so a near-duplicate of an existing member ranks lower.',
    'Ties go to whoever brings more of the missing skills, then more overlap, then whoever registered most recently.',
  ],
};

export interface Perspective {
  /** skills the team (or solo viewer) already has */
  have: string[];
  /** skills the team has asked for */
  want: string[];
  /** working windows of everyone who would have to meet */
  members: WorkWindow[];
  /**
   * Whose point of view the reasons are written from:
   *  team = a leader ranking people for their team, you = a solo person ranking people,
   *  them = a solo person ranking a team they might join.
   */
  subject: 'team' | 'you' | 'them';
}

const PHRASES = {
  team: { brings: 'Brings', asked: 'your team asked for', group: 'your team', meet: 'every member of your team', dupes: 'your team' },
  you: { brings: 'Brings', asked: 'you’re looking for', group: 'you', meet: 'you', dupes: 'your profile' },
  them: { brings: 'You bring', asked: 'this team asked for', group: 'this team', meet: 'every member of this team', dupes: 'this team' },
} as const;

export interface CandidateInput {
  skills: string[];
  window: WorkWindow;
}

const list = (ids: string[]) => {
  const labels = ids.map(skillLabel);
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
};
const roleList = (roles: Role[]) => roles.map((r) => ROLE_LABELS[r]).join(' and ');
const hours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1).replace(/\.0$/, '')} h`;

export function scoreCandidate(p: Perspective, c: CandidateInput): ScoreBreakdown & { depth: number } {
  const have = new Set(p.have);
  const cand = [...new Set(c.skills)];
  const wantOpen = [...new Set(p.want)].filter((s) => !have.has(s));
  const matched = cand.filter((s) => wantOpen.includes(s));

  const haveRoles = rolesOf(p.have);
  const missingRoles = ROLES.filter((r) => !haveRoles.has(r));
  const candRoles = rolesOf(cand);
  const newRoles = missingRoles.filter((r) => candRoles.has(r));
  const roleGain = missingRoles.length === 0 ? 0 : Math.min(1, newRoles.length / Math.min(2, missingRoles.length));

  const complement = wantOpen.length > 0 ? 0.7 * (matched.length / wantOpen.length) + 0.3 * roleGain : roleGain;

  const overlap = groupOverlapHours(c.window, p.members);
  const timezone = Math.min(overlap, OVERLAP_CAP_HOURS) / OVERLAP_CAP_HOURS;

  const shared = cand.filter((s) => have.has(s));
  const novelty = cand.length === 0 ? 0 : 1 - shared.length / cand.length;

  // which of the candidate's skills deliver each new role, so tied candidates still read differently
  const roleSkills = cand.filter((x) => newRoles.some((r) => skillRole(x) === r));
  // one representative skill per new role, in role order, so every role named is backed by a skill shown
  const perRole = newRoles.map((r) => cand.find((x) => skillRole(x) === r)).filter((x): x is string => Boolean(x));
  const rolesWithSkills = newRoles.length ? `${roleList(newRoles)} (${list(perRole)})` : '';
  const ph = PHRASES[p.subject];
  const adds = p.subject === 'them' ? 'You add' : 'Adds';
  const complementReason =
    matched.length > 0
      ? `${ph.brings} ${list(matched)}, which ${ph.asked}${newRoles.length ? `, and ${adds.toLowerCase()} ${rolesWithSkills}` : ''}.`
      : newRoles.length > 0
        ? `${adds} ${rolesWithSkills}, which nobody on ${ph.group === 'you' ? 'your side' : ph.group} covers yet.`
        : wantOpen.length > 0
          ? `None of the skills ${ph.asked} (${list(wantOpen.slice(0, 3))}).`
          : `Covers roles ${ph.group === 'you' ? 'you' : ph.group} already ${ph.group === 'you' ? 'have' : 'has'}.`;
  const meetWith = p.members.length > 1 ? ph.meet : ph.group === 'this team' ? 'the team' : ph.group;
  const tzReason =
    overlap <= 0
      ? `No working hours in common with ${meetWith}.`
      : `${hours(overlap)} of working hours overlap with ${meetWith}${overlap >= OVERLAP_CAP_HOURS ? ' (full marks)' : ''}.`;
  const noveltyReason =
    shared.length === 0
      ? `None of ${p.subject === 'them' ? 'your' : 'their'} skills duplicate ${ph.dupes}.`
      : `${shared.length} of ${cand.length} skills already on ${ph.dupes} (${list(shared)}).`;

  const components: ScoreComponent[] = [
    { key: 'complement', label: 'Complementary skills', weight: WEIGHTS.complement, value: round3(complement), points: Math.round(WEIGHTS.complement * complement), reason: complementReason },
    { key: 'timezone', label: 'Time-zone overlap', weight: WEIGHTS.timezone, value: round3(timezone), points: Math.round(WEIGHTS.timezone * timezone), reason: tzReason },
    { key: 'novelty', label: 'Skill novelty', weight: WEIGHTS.novelty, value: round3(novelty), points: Math.round(WEIGHTS.novelty * novelty), reason: noveltyReason },
  ];
  return {
    score: components.reduce((s, x) => s + x.points, 0),
    components,
    matchedSkills: matched,
    newRoles,
    overlapHours: Math.round(overlap * 100) / 100,
    depth: matched.length + roleSkills.length,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
