export const ROLES = ['frontend', 'backend', 'mobile', 'design', 'data', 'infra'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  mobile: 'Mobile',
  design: 'Design',
  data: 'Data & ML',
  infra: 'Infra',
};

export interface Skill {
  id: string;
  label: string;
  role: Role;
}

export const SKILLS = [
  { id: 'react', label: 'React', role: 'frontend' },
  { id: 'vue', label: 'Vue', role: 'frontend' },
  { id: 'svelte', label: 'Svelte', role: 'frontend' },
  { id: 'typescript', label: 'TypeScript', role: 'frontend' },
  { id: 'css', label: 'CSS', role: 'frontend' },
  { id: 'nextjs', label: 'Next.js', role: 'frontend' },
  { id: 'webgl', label: 'WebGL', role: 'frontend' },
  { id: 'node', label: 'Node.js', role: 'backend' },
  { id: 'go', label: 'Go', role: 'backend' },
  { id: 'python', label: 'Python', role: 'backend' },
  { id: 'java', label: 'Java', role: 'backend' },
  { id: 'rust', label: 'Rust', role: 'backend' },
  { id: 'postgres', label: 'Postgres', role: 'backend' },
  { id: 'graphql', label: 'GraphQL', role: 'backend' },
  { id: 'swift', label: 'Swift', role: 'mobile' },
  { id: 'kotlin', label: 'Kotlin', role: 'mobile' },
  { id: 'react-native', label: 'React Native', role: 'mobile' },
  { id: 'flutter', label: 'Flutter', role: 'mobile' },
  { id: 'figma', label: 'Figma', role: 'design' },
  { id: 'ux-research', label: 'UX research', role: 'design' },
  { id: 'ui-design', label: 'UI design', role: 'design' },
  { id: 'illustration', label: 'Illustration', role: 'design' },
  { id: 'motion', label: 'Motion', role: 'design' },
  { id: 'pytorch', label: 'PyTorch', role: 'data' },
  { id: 'llm', label: 'LLM apps', role: 'data' },
  { id: 'computer-vision', label: 'Computer vision', role: 'data' },
  { id: 'data-viz', label: 'Data viz', role: 'data' },
  { id: 'sql-analytics', label: 'SQL analytics', role: 'data' },
  { id: 'docker', label: 'Docker', role: 'infra' },
  { id: 'kubernetes', label: 'Kubernetes', role: 'infra' },
  { id: 'aws', label: 'AWS', role: 'infra' },
  { id: 'gcp', label: 'GCP', role: 'infra' },
  { id: 'security', label: 'Security', role: 'infra' },
  { id: 'ci-cd', label: 'CI/CD', role: 'infra' },
] as const satisfies readonly Skill[];

export type SkillId = (typeof SKILLS)[number]['id'];
export const SKILL_IDS = SKILLS.map((s) => s.id) as unknown as readonly [SkillId, ...SkillId[]];

const BY_ID = new Map<string, Skill>(SKILLS.map((s) => [s.id, s]));

export function skillRole(id: string): Role | undefined {
  return BY_ID.get(id)?.role;
}

export function skillLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

export function rolesOf(skills: readonly string[]): Set<Role> {
  const out = new Set<Role>();
  for (const s of skills) {
    const r = skillRole(s);
    if (r) out.add(r);
  }
  return out;
}
