import { describe, expect, it } from 'vitest';
import { isValidDecimal, sanitizeDecimalInput } from '../src/shared/filters';

describe('decimal filter inputs', () => {
  it('normalizes repeated separators and locale commas', () => {
    expect(sanitizeDecimalInput('8..5')).toBe('8.5');
    expect(sanitizeDecimalInput('8,5')).toBe('8.5');
    expect(sanitizeDecimalInput('.5')).toBe('0.5');
    expect(sanitizeDecimalInput('abc8.5x')).toBe('8.5');
  });

  it('does not leave a lone decimal separator in state', () => {
    expect(sanitizeDecimalInput('.')).toBe('');
    expect(sanitizeDecimalInput(',')).toBe('');
    expect(sanitizeDecimalInput('')).toBe('');
  });

  it('accepts only complete decimal values for request parameters', () => {
    expect(isValidDecimal('8.5')).toBe(true);
    expect(isValidDecimal('0')).toBe(true);
    expect(isValidDecimal('.')).toBe(false);
    expect(isValidDecimal('8.')).toBe(false);
    expect(isValidDecimal('8..5')).toBe(false);
    expect(isValidDecimal('')).toBe(false);
  });
});
