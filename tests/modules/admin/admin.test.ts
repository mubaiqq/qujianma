import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../../src/platform/auth-context.js';
import { MysqlAdminRepository } from '../../../src/modules/admin/repository.js';
import { registerAdminRoutes } from '../../../src/modules/admin/routes.js';
import { adminViews } from '../../../src/modules/admin/views.js';

const auth = (id: number | null): AuthContext => ({
  authenticate: vi.fn().mockResolvedValue(id === null ? null : { user: { id, username: `u${id}` }, token: 'token' }),
  require: vi.fn(), requireCsrf: vi.fn((request, reply) => { const valid = request.headers['x-csrf-token'] === 'csrf'; if (!valid) void reply.status(403).send({ code: 1, message: '请求验证失败' }); return valid; }), csrf: vi.fn().mockReturnValue('csrf'), clear: vi.fn(),
});

describe('admin repository', () => {
  it('returns overview and user list without selecting sensitive columns', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ total_users: '2', pending_parcels: '3', active_ai_users: '1' }], []])
      .mockResolvedValueOnce([[{ id: 1, username: 'root', created_at: new Date('2026-01-01'), parcel_count: '5', pending_count: '3', picked_count: '2', station_count: '1', message_count: '4', ai_count: '1', active_ai_count: '1', last_seen_at: null }], []]);
    const repository = new MysqlAdminRepository({ execute });

    expect(await repository.overview()).toEqual({ totalUsers: 2, pendingParcels: 3, activeAiUsers: 1 });
    expect((await repository.listUsers())[0]).toMatchObject({ id: 1, username: 'root', parcelCount: 5, activeAiCount: 1 });
    const sql = execute.mock.calls.map(([statement]) => String(statement)).join('\n').toLowerCase();
    expect(sql).not.toMatch(/password_hash|token_hash|token_ciphertext|api_key_ciphertext|raw_message|p256dh|\bauth\b/);
  });

  it('returns a safe user detail and safe AI provider status only', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([[{ id: 2, username: 'alice', created_at: new Date(), updated_at: new Date(), total_parcels: '8', pending_parcels: '2', picked_parcels: '6', total_stations: '3', total_messages: '9', failed_messages: '1', ai_count: '2', active_ai_count: '1', active_api_tokens: '1', push_devices: '1', last_seen_at: null }], []])
      .mockResolvedValueOnce([[{ display_name: 'OpenAI', model_name: 'gpt', is_active: 1, last_test_status: 'success', last_test_message: 'ok', last_tested_at: null }], []]);
    const repository = new MysqlAdminRepository({ execute });

    const detail = await repository.getUser(2);
    expect(detail).toMatchObject({ id: 2, username: 'alice', totalParcels: 8, providers: [{ displayName: 'OpenAI', active: true }] });
    const sql = execute.mock.calls.map(([statement]) => String(statement)).join('\n').toLowerCase();
    expect(sql).not.toMatch(/password_hash|token_hash|token_ciphertext|api_key_ciphertext|base_url|api_key_hint|raw_message|endpoint|p256dh|\bauth\b/);
  });

  it('updates articles with parameterized SQL and reports whether a row exists', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    const repository = new MysqlAdminRepository({ execute });
    const input = { title: '新标题', summary: '新摘要', contentHtml: '<p>新正文</p>' };

    expect(await repository.updateArticle(9, input)).toBe(true);
    expect(execute).toHaveBeenNthCalledWith(1, 'UPDATE published_articles SET title=?,summary=?,content_html=? WHERE id=?', ['新标题', '新摘要', '<p>新正文</p>', 9]);
    expect(await repository.updateArticle(99, input)).toBe(false);
  });

  it('deletes articles with parameterized SQL and reports whether a row exists', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    const repository = new MysqlAdminRepository({ execute });

    expect(await repository.deleteArticle(9)).toBe(true);
    expect(execute).toHaveBeenNthCalledWith(1, 'DELETE FROM published_articles WHERE id=?', [9]);
    expect(await repository.deleteArticle(99)).toBe(false);
  });
});

describe('admin views', () => {
  const summary = {
    id: 2, username: 'alice <ops>', createdAt: '2026-01-01T00:00:00.000Z', parcelCount: 8,
    pendingCount: 2, pickedCount: 6, stationCount: 3, messageCount: 9, aiCount: 1,
    activeAiCount: 1, lastSeenAt: null,
  };

  it('renders a searchable responsive dashboard without changing user routes or data', () => {
    const html = adminViews.dashboard({
      overview: { totalUsers: 1, pendingParcels: 2, activeAiUsers: 1 }, users: [summary],
    });

    expect(html).toContain('href="/admin/users/2"');
    expect(html).toContain('alice &lt;ops&gt;');
    expect(html).toContain('id="user-search"');
    expect(html).toContain('id="status-filter"');
    expect(html).toContain('data-search="alice &lt;ops&gt; 2"');
    expect(html).toContain('data-ai="active"');
    expect(html).toContain('assets/vendor/fontawesome/css/all.min.css');
    expect(html).toContain('@media(max-width:720px)');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('font-size:16px');
    expect(html).not.toContain('linear-gradient');
    expect(html).not.toContain('box-shadow');
    expect(html).not.toContain('overflow-x:auto');
    expect(html).toContain('href="/admin/push"');
  });

  it('renders an admin broadcast form with title, message, and an optional HTTP destination', () => {
    const html = adminViews.push({ csrf: 'csrf-token', result: null });
    expect(html).toContain('action="/admin/push"');
    expect(html).toContain('name="title"');
    expect(html).toContain('name="body"');
    expect(html).toContain('name="url"');
    expect(html).toContain('value="csrf-token"');
    expect(html).toContain('站内路径或完整的 HTTPS 链接');
    expect(html).toContain('链接填写说明');
    expect(html).toContain('data-copy-value="/share?t=你的分享Token"');
    expect(html).toContain('data-copy-value="/?tab=home"');
    expect(html).toContain('data-copy-value="/?tab=records"');
    expect(html).toContain('data-copy-value="/?tab=profile"');
    expect(html).toContain('data-copy-value="https://example.com/page"');
    expect(html).toContain('navigator.clipboard.writeText');
    expect(html).toContain("label.textContent='已复制'");
    expect(html).toContain('href="/admin/articles"');
    expect(html).toContain('data-command="foreColor"');
    expect(html).toContain('data-action="separator"');
    expect(html).toContain('data-action="tab"');
    expect(html).toContain('data-command="justifyCenter"');
    expect(html).toContain('data-command="createLink"');
  });

  it('renders article management with escaped data, inline editing, and a custom delete dialog', () => {
    const html = adminViews.articles({ csrf: 'csrf-token', articles: [{ id: 9, title: '<公告>', summary: '摘要<script>', contentHtml: '<p>正文</p>', authorName: '管理员', createdAt: '2026-07-31 12:00:00' }] });
    expect(html).toContain('文章管理');
    expect(html).toContain('&lt;公告&gt;');
    expect(html).toContain('摘要&lt;script&gt;');
    expect(html).toContain('data-article-id="9"');
    expect(html).toContain('data-edit-article');
    expect(html).toContain('data-delete-article');
    expect(html).toContain('id="deleteDialog"');
    expect(html).toContain("method:'PUT'");
    expect(html).toContain("method:'DELETE'");
    expect(html).toContain("button.textContent='✓ 保存成功'");
    expect(html).not.toContain('window.confirm');
    expect(html).not.toContain('alert(');
    expect(html).toContain('data-edit-command="foreColor"');
    expect(html).toContain('data-edit-action="separator"');
    expect(html).toContain('data-edit-action="tab"');
  });

  it('renders a consistent responsive user detail with safe provider values', () => {
    const html = adminViews.user({
      user: {
        id: 2, username: 'alice', createdAt: '2026-01-01', updatedAt: '2026-01-02', totalParcels: 8,
        pendingParcels: 2, pickedParcels: 6, totalStations: 3, totalMessages: 9, failedMessages: 1,
        aiCount: 1, activeAiCount: 1, activeApiTokens: 1, pushDevices: 1, lastSeenAt: null,
        providers: [{ displayName: '<OpenAI>', modelName: 'gpt<5', active: true, lastTestStatus: 'success', lastTestMessage: '<ok>', lastTestedAt: null }],
      },
    });

    expect(html).toContain('href="/admin/"');
    expect(html).toContain('&lt;OpenAI&gt;');
    expect(html).toContain('gpt&lt;5');
    expect(html).toContain('&lt;ok&gt;');
    expect(html).toContain('class="admin-shell"');
    expect(html).toContain('连接状态');
    expect(html).not.toContain('box-shadow');
  });
});

describe('admin routes', () => {
  const repository = {
    overview: vi.fn().mockResolvedValue({ totalUsers: 1, pendingParcels: 2, activeAiUsers: 1 }),
    listUsers: vi.fn().mockResolvedValue([{ id: 1, username: 'root' }]),
    getUser: vi.fn().mockResolvedValue({ id: 1, username: 'root', providers: [] }),
    createArticle: vi.fn().mockResolvedValue(42),
    listArticles: vi.fn().mockResolvedValue([]),
    getArticle: vi.fn(),
    updateArticle: vi.fn().mockResolvedValue(true),
    deleteArticle: vi.fn().mockResolvedValue(true),
  };
  const views = {
    dashboard: vi.fn((input: { overview: { totalUsers: number }; users: Array<{ id: number }> }) => `<h1>用户管理</h1><b>${input.overview.totalUsers}</b><i>${input.users.length}</i>`),
    user: vi.fn((input: { user: { username: string } }) => `<h1>用户详情</h1><b>${input.user.username}</b>`),
    push: vi.fn(() => '<h1>消息推送</h1>'),
    articles: vi.fn((input: { articles: Array<{ title: string }> }) => `<h1>文章管理</h1><b>${input.articles.map((article) => article.title).join(',')}</b>`),
  };
  const broadcaster = { broadcast: vi.fn().mockResolvedValue({ sent: 3, failed: 1 }) };

  it('redirects anonymous users and rejects every authenticated user except user_id=1', async () => {
    const anonymous = Fastify(); registerAdminRoutes(anonymous, { auth: auth(null), repository, views, broadcaster });
    expect((await anonymous.inject('/admin/')).statusCode).toBe(302);
    expect((await anonymous.inject('/admin/')).headers.location).toBe('/login');
    await anonymous.close();

    const regular = Fastify(); registerAdminRoutes(regular, { auth: auth(2), repository, views, broadcaster });
    expect((await regular.inject('/admin/')).statusCode).toBe(403);
    await regular.close();
  });

  it('renders dashboard/list and detail only for user_id=1, with 404 for missing users', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const dashboard = await app.inject('/admin/');
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.headers['content-type']).toContain('text/html');
    expect(dashboard.body).toContain('用户管理');
    expect(repository.overview).toHaveBeenCalled();
    expect(repository.listUsers).toHaveBeenCalled();

    expect((await app.inject('/admin/users/1')).body).toContain('用户详情');
    vi.mocked(repository.getUser).mockResolvedValueOnce(null);
    expect((await app.inject('/admin/users/999')).statusCode).toBe(404);
    expect((await app.inject('/admin/users/bad')).statusCode).toBe(404);
    expect((await app.inject('/admin/user.php?id=1')).statusCode).toBe(404);
    await app.close();
  });

  it('sends a broadcast only for the founder admin and accepts an internal click destination', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const response = await app.inject({ method: 'POST', url: '/admin/push', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'csrf=csrf&title=%E5%81%9C%E6%B0%B4%E6%8F%90%E9%86%92&body=%E8%AF%B7%E5%8F%8A%E6%97%B6%E9%A2%86%E5%8F%96&url=%2F%3Ftab%3Drecords' });
    expect(response.statusCode).toBe(200);
    expect(broadcaster.broadcast).toHaveBeenCalledWith({ title: '停水提醒', body: '请及时领取', url: '/?tab=records' });
    await app.close();
  });

  it('requires a matching CSRF token before broadcasting', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    vi.mocked(broadcaster.broadcast).mockClear();
    const response = await app.inject({ method: 'POST', url: '/admin/push', payload: { csrf: 'wrong', title: '标题', body: '内容', url: 'https://example.com' } });
    expect(response.statusCode).toBe(403);
    expect(broadcaster.broadcast).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts HTTPS external click destinations', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const response = await app.inject({ method: 'POST', url: '/admin/push', payload: { csrf: 'csrf', title: '标题', body: '内容', url: 'https://example.com/notice?id=1' } });
    expect(response.statusCode).toBe(200);
    expect(broadcaster.broadcast).toHaveBeenCalledWith({ title: '标题', body: '内容', url: 'https://example.com/notice?id=1' });
    await app.close();
  });

  it('rejects unsafe URL schemes', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const response = await app.inject({ method: 'POST', url: '/admin/push', payload: { csrf: 'csrf', title: '标题', body: '内容', url: 'javascript:alert(1)' } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('publishes a sanitized internal article and broadcasts its article route', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const response = await app.inject({ method: 'POST', url: '/admin/push', payload: { csrf: 'csrf', type: 'article', title: '系统公告', body: '摘要', article_content: '<h2>更新</h2><p>正文<strong>重点</strong></p><script>alert(1)</script>' } });
    expect(response.statusCode).toBe(200);
    expect(repository.createArticle).toHaveBeenCalledWith({ title: '系统公告', summary: '摘要', contentHtml: '<h2>更新</h2><p>正文<strong>重点</strong></p>', authorId: 1, authorName: '管理员' });
    expect(broadcaster.broadcast).toHaveBeenCalledWith({ title: '系统公告', body: '摘要', url: '/article/42' });
    await app.close();
  });

  it('lists published articles for the founder admin only', async () => {
    vi.mocked(repository.listArticles).mockResolvedValueOnce([{ id: 9, title: '系统公告', summary: '摘要', contentHtml: '<p>正文</p>', authorName: '管理员', createdAt: '2026-07-31' }]);
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const response = await app.inject('/admin/articles');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('文章管理');
    expect(response.body).toContain('系统公告');
    expect(views.articles).toHaveBeenCalledWith(expect.objectContaining({ csrf: 'csrf' }));
    await app.close();

    const regular = Fastify(); registerAdminRoutes(regular, { auth: auth(2), repository, views, broadcaster });
    expect((await regular.inject('/admin/articles')).statusCode).toBe(403);
    await regular.close();
  });

  it('updates a sanitized article through an admin and CSRF protected API', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const response = await app.inject({ method: 'PUT', url: '/admin/articles/9', headers: { 'x-csrf-token': 'csrf' }, payload: { title: '更新公告', summary: '新摘要', contentHtml: '<p onclick="bad()">新正文</p><script>bad()</script>' } });
    expect(response.statusCode).toBe(200);
    expect(repository.updateArticle).toHaveBeenCalledWith(9, { title: '更新公告', summary: '新摘要', contentHtml: '<p>新正文</p>' });
    expect(response.json()).toEqual({ code: 0, message: '保存成功' });
    await app.close();
  });

  it('preserves safe rich text colors, links, dividers, tables, and tab spans while stripping unsafe markup', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const rich = '<p style="color:#e74c3c;text-align:center" onclick="bad()"><strong>重点</strong><a href="https://example.com" target="_blank">链接</a><span style="color:rgb(49, 91, 234)">蓝字</span><font color="#16a085">绿字</font></p><hr><table><tbody><tr><th>项目</th><td>内容</td></tr></tbody></table><span class="article-tab" style="color:red">缩进</span><img src=x onerror=bad()><script>bad()</script>';
    const response = await app.inject({ method: 'PUT', url: '/admin/articles/9', headers: { 'x-csrf-token': 'csrf' }, payload: { title: '格式公告', summary: '摘要', contentHtml: rich } });
    expect(response.statusCode).toBe(200);
    expect(repository.updateArticle).toHaveBeenCalledWith(9, {
      title: '格式公告', summary: '摘要',
      contentHtml: '<p style="color:#e74c3c;text-align:center"><strong>重点</strong><a href="https://example.com" target="_blank" rel="noopener noreferrer">链接</a><span style="color:rgb(49, 91, 234)">蓝字</span><span style="color:#16a085">绿字</span></p><hr><table><tbody><tr><th>项目</th><td>内容</td></tr></tbody></table><span class="article-tab">缩进</span>',
    });
    await app.close();
  });

  it('deletes an article through an admin and CSRF protected API', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    const response = await app.inject({ method: 'DELETE', url: '/admin/articles/9', headers: { 'x-csrf-token': 'csrf' } });
    expect(response.statusCode).toBe(200);
    expect(repository.deleteArticle).toHaveBeenCalledWith(9);
    expect(response.json()).toEqual({ code: 0, message: '删除成功' });
    await app.close();
  });

  it('rejects missing articles, unsafe ids, invalid content, and missing CSRF', async () => {
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(1), repository, views, broadcaster });
    vi.mocked(repository.updateArticle).mockResolvedValueOnce(false);
    expect((await app.inject({ method: 'PUT', url: '/admin/articles/999', headers: { 'x-csrf-token': 'csrf' }, payload: { title: '标题', summary: '摘要', contentHtml: '<p>正文</p>' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/admin/articles/bad', headers: { 'x-csrf-token': 'csrf' }, payload: { title: '标题', summary: '摘要', contentHtml: '<p>正文</p>' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/admin/articles/9', headers: { 'x-csrf-token': 'csrf' }, payload: { title: '', summary: '摘要', contentHtml: '<p>正文</p>' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/admin/articles/9' })).statusCode).toBe(403);
    await app.close();
  });

  it('rejects article updates and deletes from non-founder users', async () => {
    vi.mocked(repository.updateArticle).mockClear();
    vi.mocked(repository.deleteArticle).mockClear();
    const app = Fastify(); registerAdminRoutes(app, { auth: auth(2), repository, views, broadcaster });
    expect((await app.inject({ method: 'PUT', url: '/admin/articles/9', headers: { 'x-csrf-token': 'csrf' }, payload: { title: '标题', summary: '摘要', contentHtml: '<p>正文</p>' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/admin/articles/9', headers: { 'x-csrf-token': 'csrf' } })).statusCode).toBe(403);
    expect(repository.updateArticle).not.toHaveBeenCalled();
    expect(repository.deleteArticle).not.toHaveBeenCalled();
    await app.close();
  });
});
