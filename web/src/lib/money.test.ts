import { describe, it, expect } from 'vitest';
import { centsFromInput, formatCents } from './money';

describe('centsFromInput', () => {
  it('parses "12" as 1200', () => expect(centsFromInput('12')).toBe(1200));
  it('parses "12.5" as 1250', () => expect(centsFromInput('12.5')).toBe(1250));
  it('parses "12.50" as 1250', () => expect(centsFromInput('12.50')).toBe(1250));
  it('parses "$1,234.56" as 123456', () => expect(centsFromInput(' $1,234.56 ')).toBe(123456));
  it('parses "12." as 1200', () => expect(centsFromInput('12.')).toBe(1200));
  it('rejects 3+ decimals', () => expect(centsFromInput('12.345')).toBeNull());
  it('rejects garbage', () => expect(centsFromInput('twelve')).toBeNull());
  it('rejects empty', () => expect(centsFromInput('  ')).toBeNull());
});

describe('formatCents', () => {
  it('formats positive', () => expect(formatCents(123456)).toBe('$1,234.56'));
  it('formats negative (refunds)', () => expect(formatCents(-500)).toBe('-$5.00'));
  it('formats zero', () => expect(formatCents(0)).toBe('$0.00'));
});
