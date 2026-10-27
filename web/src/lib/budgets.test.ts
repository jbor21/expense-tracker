import { describe, it, expect } from 'vitest';
import { effectiveBudgets } from './budgets';

const row = (category_id: string, month: string, amount_cents: number) =>
  ({ category_id, month: `${month}-01`, amount_cents });

describe('budget carry-forward', () => {
  it('carries the latest earlier month forward when the month has no row', () => {
    const eff = effectiveBudgets([row('groceries', '2026-07', 40000)], '2026-08');
    expect(eff.get('groceries')).toEqual({ amountCents: 40000, carriedFrom: '2026-07' });
  });

  it('carries across a gap of several months', () => {
    const eff = effectiveBudgets([row('groceries', '2026-03', 40000)], '2026-08');
    expect(eff.get('groceries')).toEqual({ amountCents: 40000, carriedFrom: '2026-03' });
  });

  it('an explicit row for the month wins over earlier rows', () => {
    const eff = effectiveBudgets(
      [row('groceries', '2026-07', 40000), row('groceries', '2026-08', 55000)],
      '2026-08'
    );
    expect(eff.get('groceries')).toEqual({ amountCents: 55000, carriedFrom: null });
  });

  it('an explicit zero for the month overrides carry-forward', () => {
    const eff = effectiveBudgets(
      [row('groceries', '2026-07', 40000), row('groceries', '2026-08', 0)],
      '2026-08'
    );
    expect(eff.get('groceries')).toEqual({ amountCents: 0, carriedFrom: null });
  });

  it('picks the latest earlier row, not the first seen', () => {
    const eff = effectiveBudgets(
      [row('groceries', '2026-05', 10000), row('groceries', '2026-07', 40000)],
      '2026-08'
    );
    expect(eff.get('groceries')).toEqual({ amountCents: 40000, carriedFrom: '2026-07' });
  });

  it('never leaks a future month backward', () => {
    const eff = effectiveBudgets([row('groceries', '2026-09', 40000)], '2026-08');
    expect(eff.get('groceries')).toBeUndefined();
  });

  it('resolves each category independently', () => {
    const eff = effectiveBudgets(
      [row('groceries', '2026-07', 40000), row('gas', '2026-08', 12000)],
      '2026-08'
    );
    expect(eff.get('groceries')).toEqual({ amountCents: 40000, carriedFrom: '2026-07' });
    expect(eff.get('gas')).toEqual({ amountCents: 12000, carriedFrom: null });
  });

  it('has no entry for a category that was never budgeted', () => {
    expect(effectiveBudgets([], '2026-08').get('groceries')).toBeUndefined();
  });
});
