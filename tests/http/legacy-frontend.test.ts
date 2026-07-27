import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/platform/config.js';

const root = resolve(import.meta.dirname, '../..');
const expectedHashes: Record<string, string> = {
  'public/assets/css/app.css': '4a7d00d4828a553346dd35bcd6d367fc4f72b156296e915662826535e9a0698c',
  'public/assets/js/app.js': '77cfd060a42d95cbc76ef3438cdd6e2272a4a960d0da651cc65b40c86b8d7659',
  'public/assets/js/login.js': '190a69d3f98b8ccb8db2f4b848b24dac2583d35a5398e63054fd1b45cdc55d00',
  'public/manifest.webmanifest': '1cb199ce12b4536a4221d692aadc939c9fa0bd36bab217116f5b598d8791ea7a',
  'public/service-worker.js': 'ece34bcc14edec576467a8b136c818f30bf6a8252a35d9361ca216694cb6bf70',
};

const config: AppConfig = {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 32200, LOG_LEVEL: 'silent', TZ: 'Asia/Shanghai',
  APP_VERSION: '0.1.0-test', APP_BASE_URL: 'https://pickup-next.mubaiyun.xyz',
  DB_HOST: '127.0.0.1', DB_PORT: 3306, DB_NAME: 'express_pickup', DB_USER: 'test', DB_PASSWORD: '',
  COOKIE_NAME: 'pickup_login', WORKER_ENABLED: false, WORKER_HEARTBEAT_SECONDS: 15,
};

describe('legacy frontend compatibility', () => {
  it('copies critical assets byte-for-byte', () => {
    for (const [path, expected] of Object.entries(expectedHashes)) {
      const actual = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
      expect(actual, path).toBe(expected);
    }
  });

  it('supports per-card swipe actions and keeps failed retry visible', () => {
    const css = readFileSync(resolve(root, 'public/assets/css/app.css'), 'utf8') + readFileSync(resolve(root, 'public/assets/css/settings-redesign.css'), 'utf8');
    const js = readFileSync(resolve(root, 'public/assets/js/app.js'), 'utf8');
    const home = readFileSync(resolve(root, 'views/public/home.html'), 'utf8');
    expect(css).toContain('.record-swipe{position:relative');
    expect(css).toContain('touch-action:pan-y');
    expect(css).toContain('.record-swipe-track{display:flex');
    expect(css).toContain('width:calc(100% + 144px)');
    expect(css).toContain('.record-swipe-track>.record-item{flex:0 0 calc(100% - 144px)');
    expect(css).toContain('.record-swipe-actions{flex:0 0 144px');
    expect(css).not.toContain('.record-swipe-actions{opacity:0');
    expect(js).toContain('<div class="record-swipe-track"><article');
    expect(js).toContain('</article><div class="record-swipe-actions">');
    expect(js.indexOf('data-detail-message')).toBeLessThan(js.indexOf('data-delete-record'));
    expect(js).toContain("track.style.transform=shouldOpen?'translateX(-144px)':'translateX(0)'");
    expect(js).toContain('requestAnimationFrame(()=>track.style.removeProperty');
    expect(css).toContain('background:var(--surface-solid)');
    expect(css).toContain('.settings-hero .toolbar-add{width:44px;height:44px');
    expect(css).toContain('.manual-add-button{width:38px;height:38px;min-width:38px;min-height:38px;flex:0 0 38px;aspect-ratio:1;padding:0;border:0;border-radius:50%');
    expect(css).toContain('.all-picked{width:38px;height:38px;min-width:38px;min-height:38px;flex:0 0 38px;aspect-ratio:1;padding:0;border:0;border-radius:50%');
    expect(home).toContain('data-open="cache"><span class="setting-icon cache-icon"><i class="fa-solid fa-trash-can"></i>');
    expect(home).toContain('data-open="about"');
    expect(home).toContain('id="aboutSheet"');
    expect(home).toContain('id="aboutVersion"');
    expect(home).toContain('木白');
    expect(home).toContain('738992945');
    expect(js).toContain("$('[data-open=\"about\"]')");
    expect(js).toContain('async function checkAboutUpdate');
    expect(js).toContain("openSheet('#aboutSheet');checkAboutUpdate({auto:true})");
    expect(js).toContain("localStorage.getItem('pickup:update-prompted-version')===serverVersion");
    expect(js).toContain("localStorage.setItem('pickup:update-prompted-version',serverVersion)");
    expect(js).toContain("showUpdateModal(d.version,{force:true})");
    expect(js).toContain("label.textContent='发现新版本，立即更新'");
    expect(css).toContain('.settings-hero .toolbar-add span{display:none}');
    expect(css).toContain('.station-hero .toolbar-add{background:#f0eafe;color:#7853c6}');
    expect(js).toContain("async function openNotificationSettings(){const sheet=$('#subscriptionSheet');openSheet('#subscriptionSheet')");
    expect(css).toContain('.notification-sheet-loading .notification-settings>*{display:none}');
    expect(css).toContain('.notification-sheet-loading .notification-settings:before{');
    expect(css).toContain('.notification-sheet-loading .notification-settings:after{content:"加载中..."');
    expect(js).toContain("b.querySelector('span').textContent='保存成功'");
    expect(js).not.toContain("time.value=result.data.daily_time;b.classList.add('success');b.querySelector('span').textContent='✓ 保存成功'");
    expect(js).not.toContain("openSheet('#subscriptionSheet');loadNotificationSettings()");
    expect(css).toContain('.sheet-open-loading');
    expect(css).toContain('.settings-editor-modal');
    expect(css).toContain('.settings-editor-dialog');
    expect(js).toContain('id="aiEditorModal"');
    expect(js).toContain('id="stationEditorModal"');
    expect(home).not.toContain('class="sheet-handle"');
    expect(css).not.toContain('.sheet-handle{');
    expect(css).toContain('.sheet-head{position:sticky');
    expect(css).toContain('.settings-editor-head{position:sticky');
    expect(css).toContain('.settings-editor-close');
    expect(js).toContain('id="closeAiEditor"');
    expect(js).toContain('id="closeStationEditor"');
    expect(js).toContain('document.body.appendChild(modal)');
    expect(js).toContain("$$('.settings-editor-modal').forEach");
    expect(js).toContain('closeSettingsEditor');
    expect(js).not.toContain('<form id="aiProviderForm" class="settings-editor hidden"');
    expect(js).not.toContain('<form id="stationForm" class="settings-editor hidden"');
    expect(css).toContain('.settings-field');
    expect(js).toContain('settings-editor-head');
    expect(js).toContain('station-editor-visual');
    expect(js).toContain('provider-status');
    expect(css).toContain('.record-swipe.swipe-open .record-item,.record-swipe.dragging .record-item{border-radius:15px 0 0 15px}');
    expect(css).toContain('.record-swipe.swipe-open>.record-swipe-track');
    expect(js).toContain('data-delete-record');
    expect(js).toContain('data-retry-message');
    expect(js).toContain("if(b.dataset.recordStatus==='pending')confirmBox");
    expect(js).toContain("action:'delete_record'");
  });

  it('keeps the mobile platform prompt compact and supports upward swipe dismissal', () => {
    const css = readFileSync(resolve(root, 'public/assets/css/app.css'), 'utf8');
    const js = readFileSync(resolve(root, 'public/assets/js/app.js'), 'utf8');
    expect(css).toContain('max-height:72px');
    expect(css).toContain('.platform-prompt-close{position:absolute;right:9px;top:50%');
    expect(css).toContain('touch-action:none');
    expect(css).toContain('-webkit-tap-highlight-color:transparent');
    expect(js).toContain("box.addEventListener('touchstart'");
    expect(js).toContain("box.addEventListener('touchmove'");
    expect(js).toContain("box.addEventListener('touchend'");
    expect(js).toContain("e.preventDefault()");
    expect(js).toContain("{passive:false}");
    expect(js).toContain("closeButton.addEventListener('touchstart',e=>e.stopPropagation()");
    expect(js).toContain('delta<-36');
  });

  it('includes public and views in the deployable build output', () => {
    expect(existsSync(resolve(root, 'dist/public/assets/css/app.css'))).toBe(true);
    expect(existsSync(resolve(root, 'dist/views/android.html'))).toBe(true);
    expect(
      createHash('sha256').update(readFileSync(resolve(root, 'dist/public/assets/css/app.css'))).digest('hex'),
    ).toBe(expectedHashes['public/assets/css/app.css']);
  });

  it('serves the Android 1.0.0 page at the legacy PHP path', async () => {
    const app = buildApp({ config });
    const response = await app.inject({ method: 'GET', url: '/android' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Android 正式版 1.0.0');
    expect(response.body).toContain('https://mby.lanzoue.com/i0cMJ3ykafle');
    await app.close();
  });

  it('only uses immutable caching when an asset has a non-empty version query', async () => {
    const app = buildApp({ config });
    const versioned = await app.inject({ method: 'GET', url: '/assets/css/app.css?v=20260725' });
    const unversioned = await app.inject({ method: 'GET', url: '/assets/css/app.css' });
    const emptyVersion = await app.inject({ method: 'GET', url: '/assets/css/app.css?v=' });
    expect(versioned.statusCode).toBe(200);
    expect(versioned.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(unversioned.statusCode).toBe(200);
    expect(unversioned.headers['cache-control']).not.toContain('immutable');
    expect(unversioned.headers['cache-control']).not.toContain('max-age=31536000');
    expect(emptyVersion.headers['cache-control']).not.toContain('immutable');
    await app.close();
  });

  it('does not expose public through a duplicate static route', async () => {
    const app = buildApp({ config });
    const response = await app.inject({ method: 'GET', url: '/__static__/assets/css/app.css' });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('android-page-body');
    await app.close();
  });

  it.each([
    '/assets/%2e%2e/views/android.html',
    '/assets/%252e%252e%252fviews%252fandroid.html',
    '/assets/%E0%A4%A',
    '/assets/css/%00app.css',
    '/assets/css%5c..%5c..%5cviews%5candroid.html',
  ])('rejects malformed or traversing asset path without leaking internals: %s', async (url) => {
    const app = buildApp({ config });
    const response = await app.inject({ method: 'GET', url });
    expect([400, 404]).toContain(response.statusCode);
    expect(response.body).not.toContain(root);
    expect(response.body).not.toContain('ENOENT');
    expect(response.body).not.toContain('stack');
    expect(response.body).not.toContain('android-page-body');
    await app.close();
  });

  it('keeps the guide login boundary explicit while authentication is pending', async () => {
    const app = buildApp({ config });
    const response = await app.inject({ method: 'GET', url: '/guide' });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/login');
    await app.close();
  });

  it('uses no-cache for the service worker', async () => {
    const app = buildApp({ config });
    const worker = await app.inject({ method: 'GET', url: '/service-worker.js' });
    expect(worker.statusCode).toBe(200);
    expect(worker.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
    await app.close();
  });

  it('loads the cached app shell before refreshing API data on weak networks', () => {
    const worker = readFileSync(resolve(root, 'public/service-worker.js'), 'utf8');
    const home = readFileSync(resolve(root, 'views/public/home.html'), 'utf8');
    const appJs = readFileSync(resolve(root, 'public/assets/js/app.js'), 'utf8');
    expect(worker).toContain("const APP_SHELL_KEY='/__pickup_app_shell__'");
    expect(appJs).toContain("async function openPushAfterHomeReady()");
    expect(appJs).toContain("pushTab=pushUrl.searchParams.has('tab')");
    expect(appJs).toContain("||'home'");
    expect(appJs).toContain("/^\\/articles?\\/\\d+$/");
    expect(appJs).toContain("await loadHome({incremental:homeItems.length>0})");
    expect(appJs).toContain("history.replaceState(null,'','/')");
    expect(appJs).toContain("location.assign('/push-view?target='");
    expect(appJs).not.toContain("if(launchTarget){let pushTab");
    expect(worker).toContain("if(e.request.mode==='navigate'&&u.pathname==='/')");
    expect(worker).toContain('return cached');
    expect(worker).toContain("'/assets/css/settings-redesign.css");
    expect(worker).toContain("'/manifest.webmanifest'");
    expect(worker).toContain("type==='CACHE_APP_SHELL'");
    expect(worker).toContain("type==='CLEAR_APP_SHELL'");
    expect(home).toContain("postMessage({type:'CACHE_APP_SHELL'})");
    expect(home).not.toContain("addEventListener('load',()=>navigator.serviceWorker.register");
    expect(appJs.indexOf('hydrateHomeSnapshot();')).toBeLessThan(appJs.indexOf('openPushAfterHomeReady().catch'));
    expect(appJs).toContain("if(!launchTarget)loadHome({incremental:homeItems.length>0})");
    expect(appJs).toContain('clearAppShellCache');
  });
});
