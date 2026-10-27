import { describe, it, expect } from 'vitest';
import { monthKey, monthRange, addMonths, monthLabel } from './months';

describe('month bucketing in the household timezone', () => {
  // 2026-07-01T03:00Z is still June 30, 11pm in New York.
  it('buckets by local month, not UTC', () =>
    expect(monthKey(new Date('2026-07-01T03:00:00Z'), 'America/New_York')).toBe('2026-06'));
  it('monthRange covers exactly the local month', () => {
    const r = monthRange('2026-06', 'America/New_York');
    expect(r.startISO).toBe('2026-06-01T04:00:00.000Z'); // EDT = UTC-4
    expect(r.endISO).toBe('2026-07-01T04:00:00.000Z');
  });
  it('addMonths wraps years', () => expect(addMonths('2026-12', 1)).toBe('2027-01'));
  it('monthLabel renders human form', () => expect(monthLabel('2026-06')).toBe('June 2026'));
});
