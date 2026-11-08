import { describe, it, expect } from 'vitest';
import { describeEhViewerFailure } from '../src/main/services/online-gallery';

// The reader used to show blank pages with no reason. Every EH failure shape
// now has to name itself, because they need different fixes.
describe('describeEhViewerFailure', () => {
  it('names an empty body as an unauthenticated session', () => {
    expect(describeEhViewerFailure('')).toMatch(/пустую страницу/i);
    expect(describeEhViewerFailure('   ')).toMatch(/пустую страницу/i);
  });

  it('names the image quota wall', () => {
    expect(describeEhViewerFailure('You have exceeded your image viewing limits.')).toMatch(/лимит просмотра изображений/i);
  });

  it('names the usage-rate wall', () => {
    expect(describeEhViewerFailure('You have exceeded your usage limit. reset in 30 seconds.')).toMatch(/лимит запросов/i);
  });

  it('names an IP ban', () => {
    expect(describeEhViewerFailure('Your IP address has been temporarily banned due to an excessive request rate.')).toMatch(/бан/i);
  });

  it('names the missing ExHentai session (poni=no)', () => {
    expect(describeEhViewerFailure('<html><body>?poni=no</body></html>')).toMatch(/сессии ExHentai/i);
  });

  it('falls back to a layout/auth hint with the body size', () => {
    const msg = describeEhViewerFailure('<html><body>nothing useful</body></html>');
    expect(msg).toMatch(/без img#img/);
    expect(msg).toMatch(/байт/);
  });
});
