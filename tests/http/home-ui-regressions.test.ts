import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const appJs = readFileSync(resolve(root, 'public/assets/js/app.js'), 'utf8');

describe('home UI regression contracts', () => {
  it('always settles the home loading placeholder even when data is unchanged', () => {
    expect(appJs).toContain('homeRendered');
    expect(appJs).toMatch(/if\(!unchanged\|\|!homeRendered\)/);
  });

  it('does not start swipe tracking from interactive platform-prompt controls', () => {
    expect(appJs).toMatch(/box\.addEventListener\('touchstart',e=>\{if\(e\.target\.closest\('button,a'\)\)return;/);
    expect(appJs).toContain("action.addEventListener('touchend',e=>e.stopPropagation()");
  });

  it('closes model and station editors after successful saves before refreshing lists', () => {
    expect(appJs).toMatch(/AI_SETTINGS_SAVE_CLOSE[\s\S]*closeSettingsEditor\(\);setTimeout\(loadAiSettings,700\)/);
    expect(appJs).toMatch(/STATION_SAVE_CLOSE[\s\S]*closeSettingsEditor\(\);setTimeout\(loadStations,700\)/);
  });
});
