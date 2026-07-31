import { describe, expect, it, vi } from 'vitest';
import { buildApp, type SecondBatchModules } from '../../src/app.js';
import { loadConfig } from '../../src/platform/config.js';
import type { AuthContext } from '../../src/platform/auth-context.js';

const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DB_USER: 'test' });
const user = { id: 7, username: 'alice' };
const auth: AuthContext = {
  authenticate: vi.fn(() => Promise.resolve({ user, token: 'token' })),
  require: vi.fn(() => Promise.resolve({ user, token: 'token' })),
  requireCsrf: vi.fn(() => true),
  csrf: vi.fn(() => 'csrf'),
  clear: vi.fn(),
};

const unauthenticatedAuth: AuthContext = {
  authenticate: vi.fn(() => Promise.resolve(null)),
  require: vi.fn(() => Promise.resolve(null)),
  requireCsrf: vi.fn(() => false),
  csrf: vi.fn(() => 'csrf'),
  clear: vi.fn(),
};

function modules(): SecondBatchModules {
  return {
    auth,
    tokenService: { get: vi.fn().mockResolvedValue(null), regenerate: vi.fn() },
    androidService: { list: vi.fn().mockResolvedValue([]), register: vi.fn(), revoke: vi.fn(), unregisterPush: vi.fn() },
    ingestService: { ingest: vi.fn(), ingestManual: vi.fn() },
    aiService: { status: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, data: {} } }), list: vi.fn(), save: vi.fn(), select: vi.fn(), delete: vi.fn(), fetchModels: vi.fn(), test: vi.fn() },
    officialAiService: { adminStatus: vi.fn(), publicStatus: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, data: { available: 0, selected: 0 } } }), selectForUser: vi.fn(), fetchModels: vi.fn(), test: vi.fn(), save: vi.fn() } as never,
    recognitionService: { retry: vi.fn(), recognizeImages: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: 'ok' } }) },
    sharingService: { status: vi.fn(), createOrReuse: vi.fn(), regenerate: vi.fn(), cancel: vi.fn(), getPublic: vi.fn(), markPublicPicked: vi.fn() },
    notificationService: { get: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), savePreferences: vi.fn(), testPush: vi.fn(), broadcast: vi.fn() },
    adminRepository: { overview: vi.fn().mockResolvedValue({ totalUsers: 0, pendingParcels: 0, activeAiUsers: 0 }), listUsers: vi.fn().mockResolvedValue([]), getUser: vi.fn(), createArticle: vi.fn(), listArticles: vi.fn().mockResolvedValue([]), getArticle: vi.fn(), updateArticle: vi.fn(), deleteArticle: vi.fn() },
    pageViews: { login: 'login', home: '=__PICKUP_BOOTSTRAP__;', guide: 'guide', share: '=__SHARE_TOKEN__;', push:'__PUSH_TITLE____PUSH_CONTENT____PUSH_TARGET__', article:'__ARTICLE_TITLE____ARTICLE_CONTENT____ARTICLE_META__', articles:'__ARTICLE_LIST__' },
  };
}

function queueService() {
  return { enqueue: vi.fn().mockResolvedValue({ status: 202, body: { code: 0, message: 'queued', data: { status: 'queued', message_ids: [8] } } }), retry: vi.fn().mockResolvedValue({ status: 202, body: { code: 0, message: 'queued', data: { status: 'queued', message_id: 8 } } }), deleteFailed: vi.fn().mockResolvedValue({ status: 200, body: { code: 0, message: 'deleted' } }) };
}

describe('second batch HTTP assembly', () => {
  it('mounts the authenticated and public module endpoints', async () => {
    const mounted = modules();
    mounted.ingestService.ingestManual = vi.fn().mockResolvedValue({ status: 'created', messageId: 9, codes: ['A1'], aiStatus: 'created' });
    const app = buildApp({ config, modules: mounted });
    expect((await app.inject('/api/tokens')).statusCode).toBe(200);
    expect((await app.inject('/api/app-devices')).statusCode).toBe(200);
    expect((await app.inject('/api/ai/status')).statusCode).toBe(200);
    expect((await app.inject('/api/notifications')).statusCode).toBe(200);
    const manual = await app.inject({ method: 'POST', url: '/api/manual-ingest', headers: { 'x-csrf-token': 'csrf' }, payload: { message: '取件短信' } });
    expect(manual.statusCode).toBe(200);
    expect(manual.json()).toMatchObject({ code: 0, status: 'created', message: '添加成功' });
    expect(mounted.ingestService.ingestManual).toHaveBeenCalledWith(7, '取件短信', '127.0.0.1');
    await app.close();
    const pageModules = modules();
    pageModules.auth = unauthenticatedAuth;
    const pageApp = buildApp({ config, modules: pageModules });
    expect((await pageApp.inject('/login')).body).toBe('login');
    await pageApp.close();
  });

  it('parses up to five multipart images into real buffers', async () => {
    const mounted = modules();
    const app = buildApp({ config, modules: mounted });
    const boundary = '----pickup-test';
    const payload = Buffer.from([
      `--${boundary}\r\nContent-Disposition: form-data; name="images[]"; filename="one.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      'jpeg-bytes',
      `\r\n--${boundary}--\r\n`,
    ].join(''));
    const response = await app.inject({ method: 'POST', url: '/api/image-recognize', headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-csrf-token': 'csrf' }, payload });
    expect(response.statusCode).toBe(200);
    expect(mounted.recognitionService.recognizeImages).toHaveBeenCalledWith(7, [{ bytes: Buffer.from('jpeg-bytes'), mime: 'image/jpeg' }], '127.0.0.1');
    await app.close();
  });
  it('serves the formal recognition_records delete endpoint and legacy alias through the queue service', async () => {
    const mounted = modules(); const queue = queueService(); mounted.recognitionQueueService = queue as never; const app = buildApp({ config, modules: mounted });
    for (const url of ['/api/recognition-records', '/api/recognition-records/failed']) { const response = await app.inject({ method: 'POST', url, headers: { 'x-csrf-token': 'csrf' }, payload: { action: 'delete', message_id: 8 } }); expect(response.statusCode).toBe(200); }
    expect(queue.deleteFailed).toHaveBeenCalledTimes(2); await app.close();
  });
  it('never falls through to synchronous recognition when an image retry is rejected', async () => {
    const mounted = modules(); const queue = queueService(); queue.retry.mockResolvedValue({ status: 409, body: { code: 1, message: 'busy' } }); mounted.recognitionQueueService = queue as never; const app = buildApp({ config, modules: mounted });
    const response = await app.inject({ method: 'POST', url: '/api/retry-ai', headers: { 'x-csrf-token': 'csrf' }, payload: { message_id: 8 } });
    expect(response.statusCode).toBe(409); expect(mounted.recognitionService.retry).not.toHaveBeenCalled(); await app.close();
  });
});
