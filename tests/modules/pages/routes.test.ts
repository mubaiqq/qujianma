import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../../src/platform/auth-context.js';
import { registerPageRoutes } from '../../../src/modules/pages/routes.js';

const views = {
  login: '<h1>登录</h1><button>注册</button>',
  home: '<h1>取件助手</h1><script>window.__PICKUP_BOOTSTRAP__=__PICKUP_BOOTSTRAP__;</script>',
  guide: '<h1>使用教程</h1>',
  share: '<h1>分享取件码</h1><script>window.__SHARE_TOKEN__=__SHARE_TOKEN__;</script>',
  push: '<h1 id="pushTitle">__PUSH_TITLE__</h1><button id="pushHome"><i class="fa-solid fa-chevron-left"></i></button><script>history.back()</script>__PUSH_CONTENT__',
  article: '<button id="articleHome"><i class="fa-solid fa-chevron-left"></i></button><script>history.back()</script><h1>__ARTICLE_TITLE__</h1><main>__ARTICLE_CONTENT__</main><footer>__ARTICLE_META__</footer>',
  articles: '<button id="articlesBack"></button><script>history.back()</script><main>__ARTICLE_LIST__</main>',
};

function executeInlineScripts(html: string): Record<string, unknown> {
  const window: Record<string, unknown> = {};
  const elements = new Map<string, { textContent: string; remove: () => void }>();
  const context = {
    window,
    navigator: {},
    location: { search: '', replace: vi.fn() },
    URLSearchParams,
    addEventListener: vi.fn(),
    document: {
      getElementById: (id: string) => {
        if (!elements.has(id)) elements.set(id, { textContent: '', remove: vi.fn() });
        return elements.get(id);
      },
    },
  };
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(match[0])) vm.runInNewContext(match[1] ?? '', context);
  }
  return window;
}
function auth(user: { id: number; username: string } | null): AuthContext {
  return { authenticate: vi.fn().mockResolvedValue(user === null ? null : { user, token: 'cookie' }), require: vi.fn(), requireCsrf: vi.fn(), csrf: vi.fn().mockReturnValue('csrf-token'), clear: vi.fn() };
}

describe('standalone page route factory', () => {
  it('serves login and registration UI to guests and redirects authenticated users home', async () => {
    const app = Fastify(); registerPageRoutes(app, { auth: auth(null), views });
    const login = await app.inject('/login');
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('登录');
    expect(login.body).toContain('注册');
    await app.close();

    const signedIn = Fastify(); registerPageRoutes(signedIn, { auth: auth({ id: 2, username: 'alice' }), views });
    expect((await signedIn.inject('/login')).headers.location).toBe('/');
    await signedIn.close();
  });

  it('protects home and guide, and safely injects the authenticated bootstrap', async () => {
    const guest = Fastify(); registerPageRoutes(guest, { auth: auth(null), views });
    expect((await guest.inject('/')).headers.location).toBe('/login');
    expect((await guest.inject('/guide')).headers.location).toBe('/login');
    await guest.close();

    const app = Fastify(); registerPageRoutes(app, { auth: auth({ id: 1, username: '</script><script>alert(1)</script>' }), views });
    const home = await app.inject('/');
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('csrf-token');
    expect(home.body).toContain('"is_admin":true');
    expect(home.body).not.toContain('</script><script>alert(1)</script>');
    expect((await app.inject('/guide')).body).toContain('使用教程');
    await app.close();
  });

  it('serves the public share shell without authentication and injects a safely encoded token', async () => {
    const app = Fastify(); registerPageRoutes(app, { auth: auth(null), views });
    const response = await app.inject('/share?t=%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('分享取件码');
    expect(response.body).not.toContain('</script><script>alert(1)</script>');
    expect(response.body).toContain('\\u003c/script\\u003e');
    await app.close();
  });

  it('serves an authenticated push content wrapper with a home button and safe destination', async () => {
    const app = Fastify(); registerPageRoutes(app, { auth: auth({ id: 7, username: 'alice' }), views, articles: { listArticles: vi.fn(), getArticle: vi.fn() } });
    const response = await app.inject('/push-view?target=%2Fshare%3Ft%3Dabc&title=%E5%8F%96%E4%BB%B6%E7%A0%81');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('取件码');
    expect(response.body).toContain('src="/share?t=abc"');
    expect(response.body).toContain('id="pushHome"');
    expect(response.body).toContain("history.back()");
    expect(response.body).toContain('fa-chevron-left');
    await app.close();
  });

  it('embeds safe external destinations instead of requiring a second open action', async () => {
    const app=Fastify();registerPageRoutes(app,{auth:auth({id:7,username:'alice'}),views,articles:{listArticles:vi.fn(),getArticle:vi.fn()}});
    const response=await app.inject('/push-view?target=https%3A%2F%2Fexample.com%2Fnotice&title=公告');
    expect(response.body).toContain('id="pushFrame"');
    expect(response.body).toContain('src="https://example.com/notice"');
    expect(response.body).not.toContain('打开外部页面');
    await app.close();
  });

  it('renders article detail and history for authenticated users',async()=>{
    const articles={listArticles:vi.fn().mockResolvedValue([{id:9,title:'公告',summary:'摘要',contentHtml:'<p>正文</p>',authorName:'管理员',createdAt:'2026-07-27 09:00:00'}]),getArticle:vi.fn().mockResolvedValue({id:9,title:'公告',summary:'摘要',contentHtml:'<p>正文</p>',authorName:'管理员',createdAt:'2026-07-27 09:00:00'})};
    const app=Fastify();registerPageRoutes(app,{auth:auth({id:7,username:'alice'}),views,articles});
    const detail=await app.inject('/article/9');expect(detail.body).toContain('<p>正文</p>');expect(detail.body).toContain('管理员');expect(detail.body).toContain('id="articleHome"');expect(detail.body).toContain("history.back()");expect(detail.body).toContain('fa-chevron-left');
    const legacyDetail=await app.inject('/articles/9');expect(legacyDetail.statusCode).toBe(302);expect(legacyDetail.headers.location).toBe('/article/9');
    const list=await app.inject('/articles');expect(list.body).toContain('公告');expect(list.body).toContain('href="/article/9"');expect(list.body).toContain('id="articlesBack"');expect(list.body).toContain("history.back()");
    await app.close();
  });

  it('ships readable styles for rich article colors, dividers, tables, tabs, quotes, and code',()=>{
    const template=readFileSync(resolve(process.cwd(),'views/public/article.html'),'utf8');
    expect(template).toContain('.article-content hr{');
    expect(template).toContain('.article-content table{');
    expect(template).toContain('.article-content .article-tab{');
    expect(template).toContain('.article-content blockquote{');
    expect(template).toContain('.article-content pre{');
    expect(template).toContain('overflow-x:auto');
  });

  it('supports clickable fz copy controls with custom success and failure feedback',()=>{
    const template=readFileSync(resolve(process.cwd(),'views/public/article.html'),'utf8');
    expect(template).toContain('.article-content .article-copy{');
    expect(template).toContain('id="articleCopyToast"');
    expect(template).toContain("closest('.article-copy')");
    expect(template).toContain("navigator.clipboard.writeText(copy.textContent.trim())");
    expect(template).toContain("showCopyToast('复制成功')");
    expect(template).toContain("showCopyToast('复制失败',false)");
    expect(template).not.toContain('alert(');
  });

  it('removes a deleted article from the message center and returns 404 for its old link',async()=>{
    const stored=new Map([[9,{id:9,title:'待删除公告',summary:'摘要',contentHtml:'<p>正文</p>',authorName:'管理员',createdAt:'2026-07-27 09:00:00'}]]);
    const articles={listArticles:vi.fn(async()=>[...stored.values()]),getArticle:vi.fn(async(id:number)=>stored.get(id)??null)};
    const app=Fastify();registerPageRoutes(app,{auth:auth({id:7,username:'alice'}),views,articles});
    expect((await app.inject('/articles')).body).toContain('待删除公告');
    expect((await app.inject('/article/9')).statusCode).toBe(200);
    stored.delete(9);
    expect((await app.inject('/articles')).body).not.toContain('待删除公告');
    expect((await app.inject('/article/9')).statusCode).toBe(404);
    await app.close();
  });

  it('rejects unsafe push wrapper destinations and protects the wrapper with login', async () => {
    const guest = Fastify(); registerPageRoutes(guest, { auth: auth(null), views: { ...views, push: '__PUSH_TITLE__ __PUSH_TARGET__' } });
    expect((await guest.inject('/push-view?target=https%3A%2F%2Fexample.com')).headers.location).toBe('/login');
    await guest.close();
    const app = Fastify(); registerPageRoutes(app, { auth: auth({ id: 7, username: 'alice' }), views: { ...views, push: '__PUSH_TITLE__ __PUSH_TARGET__' } });
    expect((await app.inject('/push-view?target=javascript%3Aalert(1)')).statusCode).toBe(400);
    await app.close();
  });

  it('can load the reusable views/public files through the default view loader', async () => {
    const app = Fastify(); registerPageRoutes(app, { auth: auth(null) });
    expect((await app.inject('/login')).body).toContain('loginForm');
    expect((await app.inject('/share?t=x')).body).toContain('__SHARE_TOKEN__');
    await app.close();
  });

  it('renders and really executes one safe bootstrap script with the five legacy PICKUP fields', async () => {
    const app = Fastify();
    registerPageRoutes(app, {
      auth: auth({ id: 7, username: '</script><script>globalThis.pwned=true</script>' }),
      appVersion: '2026.07.25.1',
      assetVersion: '20260725-android-release-page-1',
    });

    const response = await app.inject('/');
    const bootstrapScripts = [...response.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .filter((match) => (match[1] ?? '').includes('PICKUP'));
    expect(bootstrapScripts).toHaveLength(1);
    expect(() => executeInlineScripts(response.body)).not.toThrow();
    expect(executeInlineScripts(response.body).PICKUP).toEqual({
      csrf: 'csrf-token',
      username: '</script><script>globalThis.pwned=true</script>',
      userId: 7,
      appVersion: '2026.07.25.1',
      assetVersion: '20260725-android-release-page-1',
    });
    expect(response.body).not.toContain('</script><script>globalThis.pwned=true</script>');
    await app.close();
  });
});
