import { describe, it, expect } from 'vitest';
import { stripHtml } from '../src/parsing/htmlStripper';

describe('stripHtml', () => {
  it('rejoins a tag-split amount with no space', () =>
    expect(stripHtml('$<span>42.31</span>')).toBe('$42.31'));
  it('drops style/script/head content entirely', () =>
    expect(stripHtml('<style>.x{font-size:12px}</style>hello')).toBe('hello'));
  it('turns block boundaries into newlines', () =>
    expect(stripHtml('<tr><td>Amount</td><td>$5.00</td></tr>')).toBe('Amount\n$5.00'));
  it('decodes numeric-entity dollar signs', () =>
    expect(stripHtml('&#36;42.10')).toBe('$42.10'));
  it('decodes hex entities and named entities', () =>
    expect(stripHtml('&#x24;5.00&nbsp;at&nbsp;caf&#233;')).toBe('$5.00 at café'));
  it('caps blank-line runs at two', () =>
    expect(stripHtml('a<br><br><br><br>b')).toBe('a\n\nb'));
});
