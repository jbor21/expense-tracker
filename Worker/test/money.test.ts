import { describe, it, expect } from 'vitest';
import { centsFrom } from '../src/parsing/money';

describe('centsFrom', () => {
  it('parses a plain 2-decimal amount', () => expect(centsFrom('42.10')).toBe(4210));
  it('parses thousands commas', () => expect(centsFrom('1,234.56')).toBe(123456));
  it('rejects missing decimals', () => expect(centsFrom('42')).toBeNull());
  it('rejects 1-decimal amounts', () => expect(centsFrom('42.1')).toBeNull());
  it('rejects 3-decimal amounts', () => expect(centsFrom('42.105')).toBeNull());
  it('rejects garbage', () => expect(centsFrom('abc')).toBeNull());
  it('rejects empty', () => expect(centsFrom('')).toBeNull());
  it('never produces floats', () => expect(centsFrom('0.10')).toBe(10));
});
