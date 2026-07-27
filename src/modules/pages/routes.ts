import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../../platform/auth-context.js';
import { legacyAssetVersion, legacyVersion } from '../version/routes.js';
import type { PublishedArticle } from '../admin/repository.js';

export interface PublicPageViews { login: string; home: string; guide: string; share: string; push: string; article:string; articles:string }
export interface PageRouteOptions { auth: AuthContext; views?: PublicPageViews; viewsRoot?: string; appVersion?: string; assetVersion?: string; articles?:{listArticles():Promise<PublishedArticle[]>;getArticle(id:number):Promise<PublishedArticle|null>} }

export function loadPublicPageViews(root = resolve(process.cwd(), 'views/public')): PublicPageViews {
  return {
    login: readFileSync(resolve(root, 'login.html'), 'utf8'),
    home: readFileSync(resolve(root, 'home.html'), 'utf8'),
    guide: readFileSync(resolve(root, 'guide.html'), 'utf8'),
    share: readFileSync(resolve(root, 'share.html'), 'utf8'),
    push: readFileSync(resolve(root, 'push.html'), 'utf8'),
    article: readFileSync(resolve(root,'article.html'),'utf8'),
    articles: readFileSync(resolve(root,'articles.html'),'utf8'),
  };
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[character] ?? character);
}

function injectAssignment(html: string, variable: string, value: unknown): string {
  return html.replace(`=${variable};`, `=${safeJson(value)};`);
}

const escapeHtml=(value:string):string=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
function pushTarget(value:unknown):string|null{if(typeof value!=='string'||!value.trim())return null;const target=value.trim();if(target.startsWith('/')&&!target.startsWith('//'))return target;try{const parsed=new URL(target);return parsed.protocol==='https:'||parsed.protocol==='http:'?target:null;}catch{return null;}}

export function registerPageRoutes(app: FastifyInstance, options: PageRouteOptions): void {
  const views = options.views ?? loadPublicPageViews(options.viewsRoot);
  app.get('/login', async (request, reply) => {
    const context = await options.auth.authenticate(request, reply);
    if (context) return reply.redirect('/');
    return reply.type('text/html; charset=utf-8').send(views.login);
  });
  app.get('/', async (request, reply) => {
    const context = await options.auth.authenticate(request, reply);
    if (!context) return reply.redirect('/login');
    const bootstrap = {
      csrf: options.auth.csrf(context.token),
      username: context.user.username,
      userId: context.user.id,
      appVersion: options.appVersion ?? legacyVersion,
      assetVersion: options.assetVersion ?? legacyAssetVersion,
      user: context.user,
      is_admin: context.user.id === 1,
    };
    return reply.type('text/html; charset=utf-8').send(injectAssignment(views.home, '__PICKUP_BOOTSTRAP__', bootstrap));
  });
  app.get('/guide', async (request, reply) => {
    const context = await options.auth.authenticate(request, reply);
    if (!context) return reply.redirect('/login');
    return reply.type('text/html; charset=utf-8').send(views.guide);
  });
  app.get('/share', (request, reply) => {
    const token = (request.query as { t?: unknown }).t;
    return reply.type('text/html; charset=utf-8').send(injectAssignment(views.share, '__SHARE_TOKEN__', typeof token === 'string' ? token : ''));
  });
  app.get('/push-view', async (request, reply) => {
    const context = await options.auth.authenticate(request, reply);
    if (!context) return reply.redirect('/login');
    const query=request.query as {target?:unknown;title?:unknown};
    const target=pushTarget(query.target);
    if(!target)return reply.status(400).type('text/plain; charset=utf-8').send('通知链接无效');
    const title=typeof query.title==='string'&&query.title.trim()?query.title.trim().slice(0,80):'通知详情';
    const content=`<iframe id="pushFrame" class="push-view-frame" src="${escapeHtml(target)}" title="${escapeHtml(title)}"></iframe>`;
    return reply.type('text/html; charset=utf-8').send(views.push.split('__PUSH_TITLE__').join(escapeHtml(title)).replace('__PUSH_CONTENT__',content).replace('__PUSH_TARGET__',escapeHtml(target)));
  });
  app.get('/articles',async(request,reply)=>{const context=await options.auth.authenticate(request,reply);if(!context)return reply.redirect('/login');if(!options.articles)return reply.status(503).send('文章服务不可用');const rows=await options.articles.listArticles();const list=rows.length?rows.map(row=>`<a class="article-list-item" href="/article/${row.id}"><strong>${escapeHtml(row.title)}</strong><p>${escapeHtml(row.summary)}</p><small>${escapeHtml(row.authorName)} · ${escapeHtml(String(row.createdAt))}</small></a>`).join(''):'<div class="article-empty">暂无消息</div>';return reply.type('text/html; charset=utf-8').send(views.articles.replace('__ARTICLE_LIST__',list));});
  app.get('/articles/:id',async(request,reply)=>{const raw=(request.params as {id?:unknown}).id;return reply.redirect(`/article/${encodeURIComponent(typeof raw==='string'?raw:'')}`);});
  app.get('/article/:id',async(request,reply)=>{const context=await options.auth.authenticate(request,reply);if(!context)return reply.redirect('/login');const raw=(request.params as {id?:unknown}).id,id=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):0;if(!id||!options.articles)return reply.status(404).send('文章不存在');const row=await options.articles.getArticle(id);if(!row)return reply.status(404).send('文章不存在');return reply.type('text/html; charset=utf-8').send(views.article.split('__ARTICLE_TITLE__').join(escapeHtml(row.title)).replace('__ARTICLE_CONTENT__',row.contentHtml).replace('__ARTICLE_META__',`${escapeHtml(String(row.createdAt))} · ${escapeHtml(row.authorName)}`));});
}
