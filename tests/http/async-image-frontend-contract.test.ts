import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const appJs = readFileSync(resolve(root, 'public/assets/js/app.js'), 'utf8');
const appCss = readFileSync(resolve(root, 'public/assets/css/app.css'), 'utf8');

describe('async image recognition frontend contract', () => {
  it('previews first and only compresses each image after submit with progress feedback', () => {
    const selection = appJs.slice(appJs.indexOf("$('#imageInput').onchange"), appJs.indexOf("$('#imageRecognizeForm').onsubmit"));
    const submit = appJs.slice(appJs.indexOf("$('#imageRecognizeForm').onsubmit"), appJs.indexOf('async function loadShareStatus'));
    expect(selection).not.toContain('compressImageForAI(');
    expect(submit).toContain('正在压缩');
    expect(submit).toContain('正在上传');
    expect(submit).toContain('await compressImageForAI');
  });

  it('keeps HEIC/failures as originals, preserves transparent PNG, and converts opaque PNG to JPEG', () => {
    expect(appJs).toContain("file.type.includes('heic')||file.type.includes('heif')");
    expect(appJs).toContain('hasTransparentPixel');
    expect(appJs).toContain("hasAlpha?'image/png':'image/jpeg'");
    expect(appJs).toContain('quality=.9');
    expect(appJs).toContain('blob.size>=file.size');
    expect(appJs).toContain('catch{return file}');
    expect(appJs).toContain("imageOrientation:'from-image'");
  });

  it('accepts only queued 202 uploads and does not wait for AI results', () => {
    expect(appJs).toContain("r.status!==202");
    expect(appJs).toContain("['queued','duplicate','failed_history'].includes(status)");
    expect(appJs).toContain('d.data.message_ids');
    expect(appJs).toContain('已提交识别');
    expect(appJs).not.toContain('AI 正在识别 ${i+1}');
    expect(appJs).toContain("['queued','duplicate','failed_history']");
    expect(appJs).toContain('已识别过');
  });

  it('polls silently every ten seconds and reports combined SMS/image recognition work', () => {
    expect(appJs).toContain('条短信/图片');
    expect(appJs).toContain('setInterval(syncVisibleData,10000)');
    expect(appJs).toContain('loadAiStatus({silent:true})');
  });

  it('reports honest provider processing elapsed time and a leave-page hint after 30 seconds', () => {
    expect(appJs).toContain('AI处理中，已用时');
    expect(appJs).toContain('AI服务响应较慢，可离开页面');
    expect(appJs).toContain('30000');
  });

  it('distinguishes a timed-out queued image waiting for retry from generic recognition work', () => {
    expect(appJs).toContain('AI超时，等待重试');
  });

  it('offers queued retry and custom-confirmed deletion for failed image records', () => {
    expect(appJs).toContain("'/api/retry-ai'");
    expect(appJs).toContain("'/api/recognition-records'");
    expect(appJs).toContain("action:'delete',message_id:");
    expect(appJs).toContain('data-delete-recognition');
    expect(appJs).toContain('confirmBox(');
    expect(appJs).not.toMatch(/\b(?:alert|confirm|prompt)\s*\(/);
  });

  it('keeps mobile controls accessible without browser zoom', () => {
    expect(appCss).toContain('input,textarea,select{font-size:16px!important}');
    expect(appCss).toContain('min-height:44px');
  });
});
