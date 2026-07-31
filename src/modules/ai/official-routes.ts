import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../../platform/auth-context.js';
import type { OfficialAiService } from './official.js';
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const actionOf=(value:unknown):'fetch_models'|'test'|'save'|null=>value==='fetch_models'||value==='test'||value==='save'?value:null;
const fail=(message:string)=>({code:1 as const,message});
export function registerOfficialAiRoutes(app:FastifyInstance,options:{auth:AuthContext;service:OfficialAiService;adminView?:(input:{csrf:string;config:unknown})=>string}):void{
 const context=async(request:Parameters<AuthContext['authenticate']>[0],reply:Parameters<AuthContext['authenticate']>[1])=>options.auth.authenticate(request,reply);
 app.get('/admin/official-ai',async(request,reply)=>{const c=await context(request,reply);if(!c)return reply.redirect('/login');if(c.user.id!==1)return reply.status(403).send('无权访问');const result=await options.service.adminStatus();if(options.adminView)return reply.type('text/html; charset=utf-8').send(options.adminView({csrf:options.auth.csrf(c.token),config:result.body.data}));return reply.send(result.body)});
 app.post('/admin/official-ai',async(request,reply)=>{const c=await context(request,reply);if(!c)return reply.status(401).send(fail('请先登录'));if(c.user.id!==1)return reply.status(403).send(fail('无权访问'));if(!options.auth.requireCsrf(request,reply,c))return reply;const input=record(request.body),action=actionOf(input.action);if(!action)return reply.status(400).send(fail('未知操作'));const result=action==='fetch_models'?await options.service.fetchModels(input):action==='test'?await options.service.test(input):await options.service.save(input);return reply.status(result.status).send(result.body)});
 app.get('/api/ai/official',async(request,reply)=>{const c=await context(request,reply);if(!c)return reply.status(401).send(fail('请先登录'));const result=await options.service.publicStatus(c.user.id);return reply.status(result.status).send(result.body)});
 app.post('/api/ai/official/select',async(request,reply)=>{const c=await context(request,reply);if(!c)return reply.status(401).send(fail('请先登录'));if(!options.auth.requireCsrf(request,reply,c))return reply;const result=await options.service.selectForUser(c.user.id);return reply.status(result.status).send(result.body)});
}
