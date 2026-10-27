/** Strict 2-decimal parse — mirror of the Worker's centsFrom. Internal. */
function centsFrom(s: string): number | null {
  const parts = s.replace(/,/g, '').split('.');
  if (parts.length !== 2) return null;
  if (!/^\d+$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) return null;
  return parseInt(parts[0], 10) * 100 + parseInt(parts[1], 10);
}

/** Tolerant manual-entry path (port of Money.centsFromInput): accepts "$",
 *  commas, whitespace, and 0/1/2-decimal cents; null for anything ambiguous
 *  so the Save button stays disabled rather than guessing. */
export function centsFromInput(s: string): number | null {
  const cleaned = s.replace(/\$/g, '').replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const parts = cleaned.split('.');
  let normalized: string;
  if (parts.length === 1) normalized = `${cleaned}.00`;
  else if (parts.length === 2) {
    if (parts[1].length === 0) normalized = `${parts[0]}.00`;
    else if (parts[1].length === 1) normalized = `${parts[0]}.${parts[1]}0`;
    else if (parts[1].length === 2) normalized = cleaned;
    else return null; // 3+ decimals: ambiguous, refuse to round
  } else return null;
  return centsFrom(normalized);
}

/** The only cents→display path. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}
