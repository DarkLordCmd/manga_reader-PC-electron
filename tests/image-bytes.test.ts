import { describe, it, expect } from 'vitest';
import { isImageBuffer } from '../src/main/app/mime';

describe('isImageBuffer', () => {
  it('accepts the formats gallery sources serve', () => {
    expect(isImageBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe(true); // JPEG
    expect(isImageBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(true); // PNG
    expect(isImageBuffer(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]))).toBe(true); // GIF
    expect(
      isImageBuffer(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])),
    ).toBe(true); // WebP
    expect(
      isImageBuffer(Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif'), Buffer.alloc(4)])),
    ).toBe(true); // AVIF
  });

  it('rejects HTML limit/login walls (they must never be cached as pages)', () => {
    const limit = Buffer.from('You have exceeded your image viewing limits. Please try again later.');
    expect(isImageBuffer(limit)).toBe(false);
    expect(isImageBuffer(Buffer.from('<!DOCTYPE html><html><body>sad panda</body></html>'))).toBe(false);
    expect(isImageBuffer(Buffer.alloc(0))).toBe(false);
    expect(isImageBuffer(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false); // truncated
  });
});
