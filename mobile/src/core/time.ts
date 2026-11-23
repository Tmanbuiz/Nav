/** Date and clock helpers. Dates are local "YYYY-MM-DD"; clock times are 24-hour "HH:MM". */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isISODate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISODate(s);
  return d !== null && todayISO(d) === s;
}

/** Local midnight for an ISO date, or null. */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/** The given date if it's a Sunday, otherwise the Sunday after it. */
export function nextSunday(iso: string): string {
  const d = parseISODate(iso);
  if (!d) return iso;
  return addDays(iso, (7 - d.getDay()) % 7);
}

/** "Sun, Nov 22" */
export function formatDate(iso: string | null | undefined): string {
  const d = iso ? parseISODate(iso) : null;
  if (!d) return 'No date';
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Sunday, November 22", for Siri to say. */
export function formatDateLong(iso: string | null | undefined): string {
  const d = iso ? parseISODate(iso) : null;
  if (!d) return '';
  return `${DAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

/** "between 9:30 and 9:45 AM" or "at 9:30 AM", for Siri to say. Empty when unknown. */
export function formatSpokenWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!isHHMM(start)) return '';
  if (!isHHMM(end) || end === start) return `at ${formatClock(start)}`;
  const s = formatClock(start);
  const e = formatClock(end);
  return s.slice(-2) === e.slice(-2) ? `between ${s.slice(0, -3)} and ${e}` : `between ${s} and ${e}`;
}

export function isHHMM(s: string | null | undefined): s is string {
  return !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function toMinutes(hhmm: string | null | undefined): number | null {
  if (!isHHMM(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fromMinutes(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** "9:30 AM" */
export function formatClock(hhmm: string | null | undefined): string {
  const t = toMinutes(hhmm);
  return t === null ? '--' : formatMinutes(t);
}

export function formatMinutes(total: number | null | undefined): string {
  if (total === null || total === undefined) return '--';
  const [h, m] = fromMinutes(total).split(':').map(Number);
  const hh = h ?? 0;
  const suffix = hh < 12 ? 'AM' : 'PM';
  return `${hh % 12 === 0 ? 12 : hh % 12}:${pad(m ?? 0)} ${suffix}`;
}

/** "9:30 - 9:45 AM", or a single time when start equals end. */
export function formatWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!isHHMM(start)) return 'No pickup time';
  if (!isHHMM(end) || end === start) return formatClock(start);
  const s = formatClock(start);
  const e = formatClock(end);
  const sameHalf = s.slice(-2) === e.slice(-2);
  return sameHalf ? `${s.slice(0, -3)} - ${e}` : `${s} - ${e}`;
}

/**
 * Reads a typed time like "9:30", "9:30 am" or "13:05" into "HH:MM".
 * A bare "9:30" is read as written in 24-hour time (morning), so type "pm" for the afternoon.
 */
export function parseClockInput(input: string): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?\s*$/i.exec(input);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return `${pad(h)}:${pad(min)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
