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

  it('shows one-click official model and tutorial cards in both add and edit flows',()=>{
    expect(appJs).toContain("api('/api/ai/official')");
    expect(appJs).toContain('data-use-official');
    expect(appJs).toContain('使用官方模型');
    expect(appJs).toContain('官方模型异常，请添加自己的模型');
    expect(appJs).toContain('https://q.mcoud.cn/article/2');
    expect(appJs).toContain('自己添加模型教程');
    expect(appJs).toContain('${officialAiCard(official,true)}');
    expect(appJs).toContain("let official={available:0,selected:0};try{official=(await api('/api/ai/official')).data}catch");
  });
});
