/** Sniffs image MIME from magic bytes. Sources serve PNG/WebP/GIF/AVIF as well
 * as JPEG, so a fixed `image/jpeg` would let the renderer mislabel/cache
 * wrongly. Falls back to JPEG (the common case for gallery scrapers). */
export function detectImageMime(buf: Buffer): string {
  if (!buf || buf.length < 4) return 'image/jpeg';
  // PNG  \x89PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // JPEG \xFF\xD8\xFF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  // BMP "BM"
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  // WebP: "RIFF"...."WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  // AVIF/HEIF: ISO-BMFF "ftyp" box with an image brand
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['avif', 'avis'].includes(brand) || ['mif1', 'msf1', 'heic'].includes(brand)) return 'image/avif';
  }
  return 'image/jpeg';
}
