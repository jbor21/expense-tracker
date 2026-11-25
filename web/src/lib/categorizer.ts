/** Strip processor noise + trailing store #; must match legacy ExpenseKit `DefaultCategorizer.normalize`. */
export function normalizeMerchant(raw: string): string {
  let t = raw.toUpperCase();
  for (const prefix of ['TST*', 'SQ *', 'SQ*', 'PAYPAL *', 'PP*', 'AMZN MKTP']) {
    t = t.replaceAll(prefix, '');
  }
  t = t.replace(/\s*#\d+$/, '');
  return t.trim();
}