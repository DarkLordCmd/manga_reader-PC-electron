import { describe, it, expect } from 'vitest';
import { CH } from '../src/shared/ipc';

describe('library IPC channels', () => {
  it('exposes all library channels', () => {
    expect(CH.libraryList).toBe('library:list');
    expect(CH.libraryGet).toBe('library:get');
    expect(CH.libraryAdd).toBe('library:add');
    expect(CH.librarySetStatus).toBe('library:setStatus');
    expect(CH.librarySetNote).toBe('library:setNote');
    expect(CH.librarySetRating).toBe('library:setRating');
    expect(CH.librarySetTags).toBe('library:setTags');
    expect(CH.libraryRemove).toBe('library:remove');
    expect(CH.libraryDelete).toBe('library:delete');
    expect(CH.libraryCounts).toBe('library:counts');
    expect(CH.libraryChanged).toBe('library:changed');
  });
});
