import { ROLE_LABELS, formatUtcOffset, skillLabel, skillRole, type Role } from '@bw/shared';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? '?')][0] ?? '?';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function roleOf(skills: readonly string[]): Role | undefined {
  for (const s of skills) {
    const r = skillRole(s);
    if (r) return r;
  }
  return undefined;
}

export const roleVar = (role: Role | undefined) => (role ? `var(--role-${role})` : 'var(--ink-3)');

export function teamNumber(n: number): string {
  return `No. ${String(n).padStart(4, '0')}`;
}

export function utc(offsetMinutes: number): string {
  return formatUtcOffset(offsetMinutes);
}

/** "14:05 for them" style local time for someone at a UTC offset. */
export function localTime(offsetMinutes: number, now = new Date()): string {
  const d = new Date(now.getTime() + (offsetMinutes + now.getTimezoneOffset()) * 60_000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function relative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function expiresIn(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  if (h >= 1) return `${h} h ${m} min`;
  return `${m} min`;
}

export function seatsLeftLabel(memberCount: number, maxSize: number, locked: boolean): string {
  if (locked) return 'Roster locked';
  const left = maxSize - memberCount;
  if (left <= 0) return 'Full';
  return left === 1 ? '1 seat left' : `${left} seats left`;
}

export function listSkills(ids: readonly string[], max = 3): string {
  const labels = ids.slice(0, max).map(skillLabel);
  const more = ids.length - labels.length;
  return more > 0 ? `${labels.join(', ')} +${more}` : labels.join(', ');
}

export { ROLE_LABELS, skillLabel };

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
