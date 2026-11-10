/**
 * Working-hour overlap on the 24h UTC circle.
 * A window is a person's local working hours plus their UTC offset.
 * Windows may cross local midnight (startHour > endHour).
 */
export interface WorkWindow {
  offsetMinutes: number;
  startHour: number;
  endHour: number;
}

const DAY = 1440;

function windowMinutes(w: WorkWindow): number {
  const start = w.startHour * 60;
  const end = w.endHour * 60;
  if (end === start) return DAY;
  return end > start ? end - start : DAY - start + end;
}

/** Split a window into non-wrapping [start, end) UTC minute intervals within [0, 1440). */
function toUtcIntervals(w: WorkWindow): Array<[number, number]> {
  const length = windowMinutes(w);
  const start = (((w.startHour * 60 - w.offsetMinutes) % DAY) + DAY) % DAY;
  const end = start + length;
  if (end <= DAY) return [[start, end]];
  return [
    [start, DAY],
    [0, end - DAY],
  ];
}

export function overlapHours(a: WorkWindow, b: WorkWindow): number {
  let minutes = 0;
  for (const [as, ae] of toUtcIntervals(a)) {
    for (const [bs, be] of toUtcIntervals(b)) {
      minutes += Math.max(0, Math.min(ae, be) - Math.max(as, bs));
    }
  }
  return minutes / 60;
}

/** A team meeting needs everyone: the overlap a candidate has with the *least* compatible member. */
export function groupOverlapHours(candidate: WorkWindow, members: WorkWindow[]): number {
  if (members.length === 0) return windowMinutes(candidate) / 60;
  return Math.min(...members.map((m) => overlapHours(candidate, m)));
}

/** Circular distance between two UTC offsets, in minutes (0..720). */
export function offsetDistanceMinutes(a: number, b: number): number {
  const d = Math.abs(a - b) % DAY;
  return Math.min(d, DAY - d);
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** Current UTC offset of an IANA zone, in minutes. Returns null for an unknown zone. */
export function utcOffsetOf(timeZone: string, at: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return null;
  }
}
