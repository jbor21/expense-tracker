/** Money is integer cents everywhere. This is the only string→cents path in
 *  the Worker. Expects the bare numeric group a template captured
 *  (`[\d,]+\.\d{2}` — no currency symbol). Returns null for anything that
 *  isn't a clean 2-decimal amount, so the caller routes to review rather
 *  than guessing. "1,234.56" → 123456. */
export function centsFrom(s: string): number | null {
  const parts = s.replace(/,/g, '').split('.');
  if (parts.length !== 2) return null;
  if (!/^\d+$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) return null;
  return parseInt(parts[0], 10) * 100 + parseInt(parts[1], 10);
}
