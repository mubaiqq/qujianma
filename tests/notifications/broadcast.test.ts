import {describe,expect,it,vi} from 'vitest';
import {NotificationService} from '../../src/modules/notifications/service.js';

describe('admin notification broadcast',()=>{
  it('delivers once to every subscribed device across users',async()=>{
    const repository={listAllSubscriptions:vi.fn().mockResolvedValue([{id:1,endpoint:'https://push/1',p256dh:'p1',auth:'a1',contentEncoding:'aes128gcm'},{id:2,endpoint:'https://push/2',p256dh:'p2',auth:'a2',contentEncoding:'aes128gcm'}]),recordSuccess:vi.fn(),recordFailure:vi.fn(),deleteExpired:vi.fn()} as any;
    const sender={send:vi.fn().mockResolvedValue({success:true})};
    const service=new NotificationService(repository,sender,'key');
    expect(await service.broadcast({title:'公告',body:'正文',url:'/?tab=records'})).toEqual({sent:2,failed:0});
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(sender.send).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({title:'公告',url:'/?tab=records'}));
  });
});