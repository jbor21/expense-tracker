/** Month bucketing uses the household timezone, never UTC. */

function localParts(d: Date, tz: string): { y: number; m: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month) };
}

export function monthKey(d: Date, tz: string): string {
  const { y, m } = localParts(d, tz);
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** UTC offset (ms) of `tz` at instant `d`. */
function tzOffsetMs(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - d.getTime();
}

/** Local-midnight instant of y-m-d in tz (fixed-point via offset lookup). */
function localMidnightUTC(y: number, m: number, tz: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, 1));
  guess = new Date(guess.getTime() - tzOffsetMs(guess, tz));
  // one correction pass handles DST-boundary edge cases
  guess = new Date(Date.UTC(y, m - 1, 1) - tzOffsetMs(guess, tz));
  return guess;
}

export function monthRange(key: string, tz: string): { startISO: string; endISO: string } {
  const [y, m] = key.split('-').map(Number);
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return {
    startISO: localMidnightUTC(y, m, tz).toISOString(),
    endISO: localMidnightUTC(next.y, next.m, tz).toISOString(),
  };
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`;
}
