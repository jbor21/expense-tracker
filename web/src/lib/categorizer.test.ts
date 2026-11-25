import { describe, it, expect } from 'vitest';
import { normalizeMerchant } from './categorizer';

describe('normalizeMerchant', () => {
  it('strips processor prefix and store number', () => {
    expect(normalizeMerchant("TST* JOE'S PIZ #42")).toBe("JOE'S PIZ");
  });

  it('strips Square prefix', () => {
    expect(normalizeMerchant('SQ *COFFEE BAR')).toBe('COFFEE BAR');
  });

  it('drops trailing store number', () => {
    expect(normalizeMerchant('WHOLE FOODS #123')).toBe('WHOLE FOODS');
  });

  it('uppercases', () => {
    expect(normalizeMerchant("Trader Joe's")).toBe("TRADER JOE'S");
  });
});