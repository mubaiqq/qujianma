import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { csrfForCookie } from '../../platform/legacy-crypto.js';
import { validPositiveId } from './domain.js';
import { DeviceValidationError, type AndroidDeviceService } from './service.js';

export type AndroidSessionResolver = (request: FastifyRequest) => Promise<{ id:number } | null>;
export interface AndroidRouteOptions { service: Pick<AndroidDeviceService,'list'|'register'|'revoke'|'unregisterPush'>; resolveSession: AndroidSessionResolver; cookieName?:string; cookieRegistered?:boolean }
function bodyObject(body:unknown):Record<string,unknown>|null { if(typeof body!=='string') return body && typeof body==='object' && !Array.isArray(body) ? body as Record<string,unknown> : {}; try { const parsed:unknown=JSON.parse(body); return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {}; } catch { return null; } }
function text(body:Record<string,unknown>,key:string) { return typeof body[key]==='string' ? body[key] : undefined; }
export function registerAndroidDeviceRoutes(app:FastifyInstance, options:AndroidRouteOptions):void {
  void app.register(async routes => {
    if (!options.cookieRegistered) await routes.register(fastifyCookie);
    routes.removeAllContentTypeParsers(); routes.addContentTypeParser('*',{parseAs:'string'},(_r,b,d)=>d(null,b));
    routes.all('/api/app-devices', async(request,reply)=>{
      reply.header('Cache-Control','no-store');
      if(request.method!=='GET'&&request.method!=='POST') return reply.status(405).send({code:1,message:'仅支持GET或POST'});
      const user=await options.resolveSession(request); if(!user) return reply.status(401).send({code:1,message:'请先登录'});
      if(request.method==='GET') return {code:0,data:await options.service.list(user.id)};
      const cookie=request.cookies[options.cookieName??'pickup_login']??'';
      if((request.headers['x-csrf-token']??'')!==csrfForCookie(cookie)) return reply.status(403).send({code:1,message:'页面验证已失效，请刷新后重试'});
      const body=bodyObject(request.body); if(body===null) return reply.status(400).send({code:1,message:'JSON格式错误'});
      const action=text(body,'action')??'';
      try {
        if(action==='register') { const deviceId=text(body,'device_id'),platform=text(body,'platform'),name=text(body,'name'),appVersion=text(body,'app_version'); return {code:0,data:await options.service.register(user.id,{...(deviceId===undefined?{}:{deviceId}),...(platform===undefined?{}:{platform}),...(name===undefined?{}:{name}),...(appVersion===undefined?{}:{appVersion})})}; }
        if(action==='register_push') { const id=validPositiveId(body.id), provider=(text(body,'push_provider')??'').trim(), token=(text(body,'push_token')??'').trim(); if(id===null||provider===''||[...provider].length>40||token==='') return reply.status(422).send({code:1,message:'推送设备参数无效'}); return reply.status(503).send({code:1,message:'原生推送供应商尚未配置，未启用推送'}); }
        const id=validPositiveId(body.id); if(id===null) return reply.status(422).send({code:1,message:'设备ID无效'});
        if(action==='revoke') { await options.service.revoke(user.id,id); return {code:0,message:'设备已撤销'}; }
        if(action==='unregister_push') { await options.service.unregisterPush(user.id,id); return {code:0,message:'原生推送登记已清除'}; }
        return reply.status(400).send({code:1,message:'未知操作'});
      } catch(error) { if(error instanceof DeviceValidationError) return reply.status(422).send({code:1,message:error.message}); return reply.status(500).send({code:1,message:'设备注册失败'}); }
    });
  });
}
