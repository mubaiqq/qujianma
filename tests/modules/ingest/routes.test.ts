import Fastify from 'fastify';
import { describe,expect,it,vi } from 'vitest';
import { registerIngestRoutes } from '../../../src/modules/ingest/routes.js';
function app(){const instance=Fastify();const service={ingest:vi.fn().mockResolvedValue({status:'created',messageId:2,sender:'+861',codes:['A1'],aiStatus:'created'})};registerIngestRoutes(instance,{service,now:()=>new Date('2026-07-25T00:00:00Z')});return {instance,service};}
describe('/api/ingest formats',()=>{
 it.each([
  [{method:'GET',url:'/api/ingest?k=t&txt=hello'},'hello'],
  [{method:'POST',url:'/api/ingest?k=t',headers:{'content-type':'application/json'},payload:{message:'json'}},'json'],
  [{method:'POST',url:'/api/ingest?k=t',headers:{'content-type':'application/x-www-form-urlencoded'},payload:'txt=form'},'form'],
  [{method:'POST',url:'/api/ingest?k=t',headers:{'content-type':'text/plain'},payload:'plain'},'plain'],
 ] as const)('accepts compatible request format %#',async(options,message)=>{const {instance,service}=app();const response=await instance.inject(options);expect(response.statusCode).toBe(200);expect(service.ingest).toHaveBeenCalledWith('t',expect.objectContaining({message}),expect.any(String));await instance.close();});
 it('rejects missing token and oversized decoded SMS',async()=>{const {instance}=app();expect((await instance.inject({method:'GET',url:'/api/ingest?txt=x'})).statusCode).toBe(401);expect((await instance.inject({method:'POST',url:'/api/ingest?k=t',payload:'x'.repeat(4001)})).statusCode).toBe(413);await instance.close();});
});
