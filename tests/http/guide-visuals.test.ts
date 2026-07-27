import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const guide = readFileSync(resolve(root, 'views/public/guide.html'), 'utf8');
const css = readFileSync(resolve(root, 'public/assets/css/app.css'), 'utf8');

describe('visual guide contract', () => {
  it('provides one local, accessible illustration for every tutorial section', () => {
    const images = [...guide.matchAll(/<img class="guide-visual-image" src="([^"]+)" alt="([^"]+)"/g)];
    expect(images).toHaveLength(5);
    for (const [, src, alt] of images) {
      expect(src).toMatch(/^\/assets\/images\/guide\/[a-z0-9-]+\.svg\?v=20260727-guide-visuals-1$/);
      expect(alt.trim().length).toBeGreaterThan(6);
      expect(readFileSync(resolve(root, `public${src.split('?')[0]}`), 'utf8')).toContain('<svg');
    }
  });

  it('keeps tutorial illustrations responsive and compact on mobile', () => {
    expect(css).toContain('.guide-visual{');
    expect(css).toContain('.guide-visual-image{display:block;width:100%;height:auto');
  });
});
