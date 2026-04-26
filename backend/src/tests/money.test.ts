import { describe, it, expect } from 'vitest';
import { rupeesToPaise, paiseToRupees } from '../lib/money.js';

describe('rupeesToPaise', () => {
  it.each([
    ['324', 32400],
    ['324.5', 32450],
    ['324.50', 32450],
    ['0.01', 1],
    ['0.10', 10],
    ['1', 100],
    ['1000', 100000],
  ])('converts "%s" to %d paise', (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected);
  });

  it.each(['-1', 'abc', '1.234', '', '1e2', '-0.01', '1.2.3', ' 10', '10 '])(
    'rejects "%s"',
    (input) => {
      expect(() => rupeesToPaise(input)).toThrow();
    }
  );
});

describe('paiseToRupees', () => {
  it.each([
    [32450, '324.50'],
    [1, '0.01'],
    [100, '1.00'],
    [100000, '1000.00'],
  ])('converts %d paise to "%s"', (input, expected) => {
    expect(paiseToRupees(input)).toBe(expected);
  });
});
