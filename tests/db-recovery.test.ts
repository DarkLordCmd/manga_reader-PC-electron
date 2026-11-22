import { describe, it, expect } from 'vitest';
import { isCorruptionError, shouldRotateDatabase } from '../src/main/services/db-recovery';

describe('database corruption classification', () => {
  it('recognises SQLite corruption codes', () => {
    expect(isCorruptionError({ code: 'SQLITE_CORRUPT' })).toBe(true);
    expect(isCorruptionError({ code: 'SQLITE_NOTADB' })).toBe(true);
    expect(isCorruptionError({ code: 'SQLITE_CORRUPT_VTAB' })).toBe(true);
  });

  it('does NOT treat transient failures as corruption', () => {
    // Regression: any error used to rotate library.db aside and open an empty
    // database, so a brief lock / EACCES / full disk looked like total data
    // loss ("вся библиотека и история исчезли").
    expect(shouldRotateDatabase({ code: 'SQLITE_BUSY' })).toBe(false);
    expect(shouldRotateDatabase({ code: 'SQLITE_READONLY' })).toBe(false);
    expect(shouldRotateDatabase({ code: 'EACCES' })).toBe(false);
    expect(shouldRotateDatabase(new Error('disk I/O error'))).toBe(false);
    expect(shouldRotateDatabase(null)).toBe(false);
    expect(shouldRotateDatabase(undefined)).toBe(false);
  });
});
