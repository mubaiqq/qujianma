import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { OfficialAiService } from '../../../src/modules/ai/official.js';
import { registerOfficialAiRoutes } from '../../../src/modules/ai/official-routes.js';

describe('official AI configuration',()=>{
  const stored={id:1,display_name:'官方模型',base_url:'https://api.example/v1',api_key_ciphertext:'cipher',api_key_hint:'sk••••1234',model_name:'vision',is_enabled:1,last_test_status:'success',last_test_message:'连接正常',last_tested_at:null};
  const repository={get:vi.fn().mockResolvedValue(stored),save:vi.fn(),updateTest:vi.fn(),getForUser:vi.fn().mockResolvedValue({id:1,display_name:'官方模型',model_name:'vision',is_enabled:1,selected:0,available:1}),selectForUser:vi.fn()};
  const client={fetchModels:vi.fn().mockResolvedValue(['vision','text']),test:vi.fn().mockResolvedValue(undefined)};
  const service=new OfficialAiService(repository,{encrypt:(v)=>`enc:${v}`,decrypt:()=> 'plain-key',validateUrl:()=>Promise.resolve(true),client});

  it('keeps one encrypted admin configuration, fetches models, tests and toggles free access',async()=>{
    await expect(service.fetchModels({base_url:'https://api.example/v1',api_key:''})).resolves.toMatchObject({status:200,body:{data:{models:['vision','text']}}});
    await expect(service.test({base_url:'https://api.example/v1',api_key:'',model_name:'vision'})).resolves.toMatchObject({status:200});
    expect(repository.updateTest).not.toHaveBeenCalled();
    await expect(service.save({display_name:'官方免费模型',base_url:'https://api.example/v1',api_key:'new-key',model_name:'vision',is_enabled:true})).resolves.toMatchObject({status:200});
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({displayName:'官方免费模型',apiKeyCiphertext:'enc:new-key',isEnabled:true}));
    expect(repository.updateTest).toHaveBeenCalledWith('success','连接正常');
  });

  it('does not persist a test action and refuses to enable an unreachable configuration',async()=>{repository.save.mockClear();repository.updateTest.mockClear();client.test.mockRejectedValueOnce(new Error('offline'));await expect(service.test({base_url:'https://api.example/v1',api_key:'new-key',model_name:'vision'})).resolves.toMatchObject({status:422});expect(repository.save).not.toHaveBeenCalled();expect(repository.updateTest).not.toHaveBeenCalled();client.test.mockRejectedValueOnce(new Error('offline'));await expect(service.save({display_name:'官方',base_url:'https://api.example/v1',api_key:'new-key',model_name:'vision',is_enabled:true})).resolves.toMatchObject({status:422});expect(repository.save).not.toHaveBeenCalled();});

  it('lets a user select only an enabled healthy official model and exposes abnormal state',async()=>{
    await expect(service.publicStatus(7)).resolves.toMatchObject({status:200,body:{data:{available:1,selected:0}}});
    await expect(service.selectForUser(7)).resolves.toMatchObject({status:200,body:{message:'已选择官方模型'}});
    expect(repository.selectForUser).toHaveBeenCalledWith(7);
    repository.getForUser.mockResolvedValueOnce({id:1,display_name:'官方模型',model_name:'vision',selected:1,available:0,is_enabled:0});
    await expect(service.publicStatus(7)).resolves.toMatchObject({body:{data:{available:0,selected:1}}});
  });

  it('protects admin mutations and exposes user status/select routes',async()=>{
    const auth={authenticate:vi.fn().mockResolvedValue({user:{id:1},token:'t'}),requireCsrf:vi.fn().mockReturnValue(true),csrf:vi.fn(),require:vi.fn(),clear:vi.fn()};
    const app=Fastify();registerOfficialAiRoutes(app,{auth,service});
    expect((await app.inject('/admin/official-ai')).statusCode).toBe(200);
    expect((await app.inject('/api/ai/official')).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/ai/official/select',headers:{'x-csrf-token':'csrf'}})).statusCode).toBe(200);
    await app.close();
  });

  it('rejects unknown admin actions instead of treating them as save',async()=>{const auth={authenticate:vi.fn().mockResolvedValue({user:{id:1},token:'t'}),requireCsrf:vi.fn().mockReturnValue(true),csrf:vi.fn(),require:vi.fn(),clear:vi.fn()};const app=Fastify();registerOfficialAiRoutes(app,{auth,service});expect((await app.inject({method:'POST',url:'/admin/official-ai',payload:{action:'delete_everything'}})).statusCode).toBe(400);await app.close();});
});
