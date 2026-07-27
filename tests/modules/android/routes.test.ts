import Fastify from 'fastify';
import { describe,expect,it,vi } from 'vitest';
import { csrfForCookie } from '../../../src/platform/legacy-crypto.js';
import { registerAndroidDeviceRoutes } from '../../../src/modules/android/routes.js';

function app() { const instance=Fastify(); const service={list:vi.fn().mockResolvedValue([{id:1,token_prefix:'abcd'}]),register:vi.fn().mockResolvedValue({token:'secret',device:{id:1}}),revoke:vi.fn(),unregisterPush:vi.fn()}; registerAndroidDeviceRoutes(instance,{service,resolveSession:vi.fn().mockResolvedValue({id:7})}); return {instance,service}; }
describe('/api/app-devices routes',()=>{
 it('lists only service-provided safe device metadata',async()=>{const {instance}=app();const response=await instance.inject({method:'GET',url:'/api/app-devices'});expect(response.json()).toEqual({code:0,data:[{id:1,token_prefix:'abcd'}]});await instance.close();});
 it('requires CSRF for writes and returns fixed unconfigured push response',async()=>{const {instance}=app();const cookie='login';const response=await instance.inject({method:'POST',url:'/api/app-devices',headers:{cookie:`pickup_login=${cookie}`,'x-csrf-token':csrfForCookie(cookie)},payload:{action:'register_push',id:1,push_provider:'fcm',push_token:'push'}});expect(response.statusCode).toBe(503);expect(response.json()).toEqual({code:1,message:'原生推送供应商尚未配置，未启用推送'});await instance.close();});
});
