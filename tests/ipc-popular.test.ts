import { describe, it, expect } from 'vitest';
import { CH } from '../src/shared/ipc';

describe('popular IPC', () => {
  it('exposes channel', () => {
    expect(CH.catalogPopular).toBe('catalog:popular');
  });
});
