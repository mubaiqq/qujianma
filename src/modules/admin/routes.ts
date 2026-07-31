import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../../platform/auth-context.js';
import type { AdminOverview, AdminRepository, AdminUserDetail, AdminUserSummary, PublishedArticle } from './repository.js';

export interface AdminViews {
  dashboard(input: { overview: AdminOverview; users: AdminUserSummary[] }): string;
  user(input: { user: AdminUserDetail }): string;
  push(input: { csrf: string; result: { sent: number; failed: number } | null; error?: string }): string;
  articles(input: { csrf: string; articles: PublishedArticle[] }): string;
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
const text=(value:unknown,fallback=''):string=>typeof value==='string'?value:fallback;
const validDestination=(value:string):boolean=>{if(value.startsWith('/')&&!value.startsWith('//'))return true;try{const parsed=new URL(value);return parsed.protocol==='https:'||parsed.protocol==='http:';}catch{return false;}};
const richTags=new Set(['p','div','h1','h2','h3','h4','strong','b','em','i','u','s','ul','ol','li','blockquote','br','hr','pre','code','table','thead','tbody','tr','th','td','span','font','a']);
const safeColor=(value:string):string|null=>/^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*\))$/i.test(value.trim())?value.trim().toLowerCase():null;
const richAttrs=(tag:string,raw:string):string=>{const attrs=Array.from(raw.matchAll(/([a-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)),get=(name:string)=>attrs.find(match=>match[1]?.toLowerCase()===name)?.[2]??attrs.find(match=>match[1]?.toLowerCase()===name)?.[3]??'';if(tag==='a'){const href=get('href').trim();if(!/^(?:https?:\/\/|\/[^/])/i.test(href))return '';const target=get('target')==='_blank'?' target="_blank" rel="noopener noreferrer"':'';return ` href="${href.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"${target}`;}if(tag==='span'&&get('class').split(/\s+/).includes('article-tab'))return ' class="article-tab"';if(tag==='font'){const color=safeColor(get('color'));return color?` style="color:${color}"`:'';}if(tag==='span'||['p','div','h1','h2','h3','h4','blockquote','td','th'].includes(tag)){const style=get('style'),parts:string[]=[];for(const declaration of style.split(';')){const [rawName,...rawValue]=declaration.split(':'),name=rawName?.trim().toLowerCase(),value=rawValue.join(':').trim();if(name==='color'){const color=safeColor(value);if(color)parts.push(`color:${color}`);}if(name==='text-align'&&['left','center','right','justify'].includes(value.toLowerCase()))parts.push(`text-align:${value.toLowerCase()}`);}return parts.length?` style="${parts.join(';')}"`:'';}return '';};
const sanitizeArticle=(html:string):string=>html.replace(/<(script|style|iframe|object|embed|form|svg|math)[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<\s*\/\s*([a-z0-9]+)[^>]*>/gi,(_tag,name:string)=>{const tag=name.toLowerCase();return richTags.has(tag)&&!['br','hr'].includes(tag)?`</${tag==='font'?'span':tag}>`:'';}).replace(/<\s*([a-z0-9]+)([^>]*)>/gi,(_tag,name:string,attrs:string)=>{const tag=name.toLowerCase();return richTags.has(tag)?`<${tag==='font'?'span':tag}${richAttrs(tag,attrs)}>`:'';}).trim();
const articleId=(raw:unknown):number=>typeof raw==='string'&&/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))&&Number(raw)>0?Number(raw):0;
const articleInput=(body:unknown):{title:string;summary:string;contentHtml:string}|null=>{const input=object(body),title=text(input.title).trim(),summary=text(input.summary).trim(),contentHtml=sanitizeArticle(text(input.contentHtml,text(input.article_content)).trim());return title.length>0&&title.length<=80&&summary.length>0&&summary.length<=240&&contentHtml.length>0&&contentHtml.length<=100_000?{title,summary,contentHtml}:null;};

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

  app.get('/admin/articles',async(request,reply)=>{
    if(!await isAdmin(options.auth,request,reply))return reply;
    const context=await options.auth.authenticate(request,reply);if(!context)return reply;
    return reply.type('text/html; charset=utf-8').send(options.views.articles({csrf:options.auth.csrf(context.token),articles:await options.repository.listArticles()}));
  });

  app.put('/admin/articles/:id',async(request,reply)=>{
    if(!await isAdmin(options.auth,request,reply))return reply;
    const context=await options.auth.authenticate(request,reply);if(!context||!options.auth.requireCsrf(request,reply,context))return reply;
    const id=articleId((request.params as {id?:unknown}).id);if(!id)return reply.status(404).send({code:1,message:'文章不存在'});
    const input=articleInput(request.body);if(!input)return reply.status(400).send({code:1,message:'请填写有效的标题、摘要和正文'});
    if(!await options.repository.updateArticle(id,input))return reply.status(404).send({code:1,message:'文章不存在'});
    return reply.send({code:0,message:'保存成功'});
  });

  app.delete('/admin/articles/:id',async(request,reply)=>{
    if(!await isAdmin(options.auth,request,reply))return reply;
    const context=await options.auth.authenticate(request,reply);if(!context||!options.auth.requireCsrf(request,reply,context))return reply;
    const id=articleId((request.params as {id?:unknown}).id);if(!id)return reply.status(404).send({code:1,message:'文章不存在'});
    if(!await options.repository.deleteArticle(id))return reply.status(404).send({code:1,message:'文章不存在'});
    return reply.send({code:0,message:'删除成功'});
  });

  app.post('/admin/push', async (request, reply) => {
    if (!await isAdmin(options.auth, request, reply)) return reply;
    const context = await options.auth.authenticate(request, reply);
    if (!context) return reply;
    const form = object(request.body);
    const originalCsrf = request.headers['x-csrf-token'];
    request.headers['x-csrf-token'] = text(form.csrf);
    const csrfValid = options.auth.requireCsrf(request, reply, context);
    if (originalCsrf === undefined) delete request.headers['x-csrf-token']; else request.headers['x-csrf-token'] = originalCsrf;
    if (!csrfValid) return reply;
    const type=text(form.type,'link');
    const title = text(form.title).trim(), body = text(form.body).trim(), url = text(form.url,'/').trim() || '/';
    if (title.length < 1 || title.length > 80 || body.length < 1 || body.length > 240) {
      return reply.status(400).type('text/html; charset=utf-8').send(options.views.push({ csrf: options.auth.csrf(context.token), result: null, error: '请填写有效标题和内容' }));
    }
    if(type==='article'){
      const contentHtml=sanitizeArticle(text(form.article_content).trim());
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
