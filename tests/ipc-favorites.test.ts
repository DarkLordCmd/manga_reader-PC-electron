import { describe, it, expect } from 'vitest';
import { CH } from '../src/shared/ipc';

describe('favorites IPC channels', () => {
  it('exposes channels', () => {
    expect(CH.libraryLookup).toBe('library:lookup');
    expect(CH.librarySetFavorite).toBe('library:setFavorite');
    expect(CH.libraryAddFavorite).toBe('library:addFavorite');
    expect(CH.librarySetStatusFor).toBe('library:setStatusFor');
  });
});
