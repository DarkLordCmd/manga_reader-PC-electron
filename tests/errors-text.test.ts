import { describe, it, expect } from 'vitest';
import { errorText } from '../src/renderer/src/lib/errors';

describe('errorText', () => {
  it('strips the Electron IPC wrapper from a main-process error', () => {
    expect(
      errorText(
        new Error("Error invoking remote method 'catalog:popular': Error: E-Hentai вернул пустую страницу (exhentai.org)"),
      ),
    ).toBe('E-Hentai вернул пустую страницу (exhentai.org)');
  });

  it('handles a non-Error inner payload', () => {
    expect(errorText(new Error("Error invoking remote method 'library:add': boom"))).toBe('boom');
  });

  it('keeps a plain message untouched', () => {
    expect(errorText(new Error('plain failure'))).toBe('plain failure');
    expect(errorText('string failure')).toBe('string failure');
  });

  it('never renders an empty message', () => {
    expect(errorText(new Error("Error invoking remote method 'x': "))).toBe('Неизвестная ошибка');
    expect(errorText(new Error(''))).toBe('Неизвестная ошибка');
    expect(errorText(null)).toBe('Неизвестная ошибка');
    expect(errorText(undefined)).toBe('Неизвестная ошибка');
  });
});
