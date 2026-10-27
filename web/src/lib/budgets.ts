/**
 * Budget carry-forward: a month with no explicit budget row inherits the most
 * recent earlier month's amount, per category. Setting a budget once keeps it
 * in force every month after until it's changed. Future rows never leak back.
 */

export interface BudgetRow {
  category_id: string;
  /** `YYYY-MM-DD` (always the first of the month) as stored in Supabase. */
  month: string;
  amount_cents: number;
}

export interface EffectiveBudget {
  amountCents: number;
  /** `YYYY-MM` of the row it was carried from; `null` when the month is explicit. */
  carriedFrom: string | null;
}

/** `rows` may span any months; only rows at or before `month` (`YYYY-MM`) count. */
export function effectiveBudgets(rows: BudgetRow[], month: string): Map<string, EffectiveBudget> {
  const out = new Map<string, EffectiveBudget>();
  for (const r of rows) {
    const m = r.month.slice(0, 7);
    if (m > month) continue;
    const prev = out.get(r.category_id);
    if (prev && (prev.carriedFrom === null || (prev.carriedFrom ?? '') >= m)) continue;
    out.set(r.category_id, { amountCents: r.amount_cents, carriedFrom: m === month ? null : m });
  }
  return out;
}
