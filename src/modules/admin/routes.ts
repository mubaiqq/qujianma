import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../../platform/auth-context.js';
import type { AdminOverview, AdminRepository, AdminUserDetail, AdminUserSummary } from './repository.js';

export interface AdminViews {
  dashboard(input: { overview: AdminOverview; users: AdminUserSummary[] }): string;
  user(input: { user: AdminUserDetail }): string;
  push(input: { csrf: string; result: { sent: number; failed: number } | null; error?: string }): string;
}

export interface AdminBroadcaster { broadcast(input: { title: string; body: string; url: string }): Promise<{ sent: number; failed: number }> }

export interface AdminRouteOptions {
  auth: AuthContext;
  repository: AdminRepository;
  views: AdminViews;
  broadcaster: AdminBroadcaster;
}

async function isAdmin(
  auth: AuthContext,
  request: Parameters<AuthContext['authenticate']>[0],
  reply: Parameters<AuthContext['authenticate']>[1],
): Promise<boolean> {
  const context = await auth.authenticate(request, reply);
  if (!context) {
    void reply.redirect('/login');
    return false;
  }
  if (context.user.id !== 1) {
    void reply.status(403).type('text/plain; charset=utf-8').send('无权访问');
    return false;
  }
  return true;
}

const object=(value:unknown):Record<string,unknown>=>{if(value&&typeof value==='object'&&!Array.isArray(value))return value as Record<string,unknown>;if(typeof value==='string')return Object.fromEntries(new URLSearchParams(value));return {}};
const validDestination=(value:string):boolean=>{if(value.startsWith('/')&&!value.startsWith('//'))return true;try{const parsed=new URL(value);return parsed.protocol==='https:'||parsed.protocol==='http:';}catch{return false;}};
const sanitizeArticle=(html:string):string=>html.replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1\s*>/gi,'').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/\s(href|src)\s*=\s*(["'])\s*(javascript:|data:)[\s\S]*?\2/gi,'');

export function registerAdminRoutes(app: FastifyInstance, options: AdminRouteOptions): void {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16_384 }, (_request, body, done) => done(null, body));
  app.get('/admin/', async (request, reply) => {
    if (!await isAdmin(options.auth, request, reply)) return reply;
    const [overview, users] = await Promise.all([options.repository.overview(), options.repository.listUsers()]);
    return reply.type('text/html; charset=utf-8').send(options.views.dashboard({ overview, users }));
  });

  app.get('/admin/users/:id', async (request, reply) => {
    if (!await isAdmin(options.auth, request, reply)) return reply;
    const rawId = (request.params as { id?: unknown }).id;
    const id = typeof rawId === 'string' && /^\d+$/.test(rawId) ? Number(rawId) : 0;
    if (!Number.isSafeInteger(id) || id < 1) return reply.status(404).type('text/plain; charset=utf-8').send('用户不存在');
    const user = await options.repository.getUser(id);
    if (!user) return reply.status(404).type('text/plain; charset=utf-8').send('用户不存在');
    return reply.type('text/html; charset=utf-8').send(options.views.user({ user }));
  });

  app.get('/admin/push', async (request, reply) => {
    if (!await isAdmin(options.auth, request, reply)) return reply;
    const context = await options.auth.authenticate(request, reply);
    if (!context) return reply;
    return reply.type('text/html; charset=utf-8').send(options.views.push({ csrf: options.auth.csrf(context.token), result: null }));
  });

  app.post('/admin/push', async (request, reply) => {
    if (!await isAdmin(options.auth, request, reply)) return reply;
    const context = await options.auth.authenticate(request, reply);
    if (!context) return reply;
    const form = object(request.body);
    const originalCsrf = request.headers['x-csrf-token'];
    request.headers['x-csrf-token'] = String(form.csrf ?? '');
    const csrfValid = options.auth.requireCsrf(request, reply, context);
    if (originalCsrf === undefined) delete request.headers['x-csrf-token']; else request.headers['x-csrf-token'] = originalCsrf;
    if (!csrfValid) return reply;
    const type=String(form.type??'link');
    const title = String(form.title ?? '').trim(), body = String(form.body ?? '').trim(), url = String(form.url ?? '/').trim() || '/';
    if (title.length < 1 || title.length > 80 || body.length < 1 || body.length > 240) {
      return reply.status(400).type('text/html; charset=utf-8').send(options.views.push({ csrf: options.auth.csrf(context.token), result: null, error: '请填写有效标题和内容' }));
    }
    if(type==='article'){
      const contentHtml=sanitizeArticle(String(form.article_content??'').trim());
      if(!contentHtml||contentHtml.length>100_000)return reply.status(400).type('text/html; charset=utf-8').send(options.views.push({csrf:options.auth.csrf(context.token),result:null,error:'请填写有效文章内容'}));
      const id=await options.repository.createArticle({title,summary:body,contentHtml,authorId:context.user.id,authorName:'管理员'});
      const result=await options.broadcaster.broadcast({title,body,url:`/article/${id}`});
      return reply.type('text/html; charset=utf-8').send(options.views.push({csrf:options.auth.csrf(context.token),result}));
    }
    if(!validDestination(url))return reply.status(400).type('text/html; charset=utf-8').send(options.views.push({ csrf: options.auth.csrf(context.token), result: null, error: '请填写有效 HTTP/HTTPS 链接' }));
    const result = await options.broadcaster.broadcast({ title, body, url });
    return reply.type('text/html; charset=utf-8').send(options.views.push({ csrf: options.auth.csrf(context.token), result }));
  });
}
