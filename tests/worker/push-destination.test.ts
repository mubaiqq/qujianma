import {describe,expect,it,vi} from 'vitest';
import {NotificationWorkerPush} from '../../src/worker/push.js';

describe('notification click destinations',()=>{
  it('opens only the app home for daily and overdue automatic reminders',async()=>{
    const notifications={send:vi.fn().mockResolvedValue({sent:1,failed:0})};
    const push=new NotificationWorkerPush(notifications as never);
    await push.sendDaily(7,2);
    await push.sendOverdue(7,48);
    expect(notifications.send).toHaveBeenNthCalledWith(1,7,expect.objectContaining({url:'/'}));
    expect(notifications.send).toHaveBeenNthCalledWith(2,7,expect.objectContaining({url:'/'}));
  });
});
