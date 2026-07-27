import {describe,expect,it,vi} from 'vitest';
import {MysqlNotificationRepository} from '../../src/modules/notifications/repository.js';

describe('notification preferences repository',()=>{
  it('makes a changed daily schedule eligible again on the same day',async()=>{
    const execute=vi.fn().mockResolvedValue([[],[]]);
    const repository=new MysqlNotificationRepository({execute});
    await repository.savePreferences(1,{new_pending_enabled:true,daily_enabled:true,daily_time:'18:05',timezone:'Asia/Shanghai'});
    expect(execute).toHaveBeenCalledOnce();
    const [sql]=execute.mock.calls[0];
    expect(sql).toContain('last_daily_sent_date=IF(');
    expect(sql).toContain('NULL,last_daily_sent_date');
  });
});