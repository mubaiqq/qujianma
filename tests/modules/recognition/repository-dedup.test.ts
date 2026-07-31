import { describe,expect,it,vi } from 'vitest';
import { MysqlRecognitionRepository } from '../../../src/modules/recognition/repository.js';

describe('recognition pickup-code deduplication',()=>{
  it('ignores only exactly equal codes already owned by the user and inserts the other codes',async()=>{
    const execute=vi.fn()
      .mockResolvedValueOnce([[{id:7}],[]])
      .mockResolvedValueOnce([[{id:3}],[]])
      .mockResolvedValueOnce([[{pickup_code:'A-1'}],[]])
      .mockResolvedValueOnce([{affectedRows:1},[]])
      .mockResolvedValueOnce([{affectedRows:1},[]])
      .mockResolvedValueOnce([{affectedRows:1},[]])
      .mockResolvedValueOnce([{affectedRows:1},[]]);
    const connection={execute,beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()};
    const repository=new MysqlRecognitionRepository({execute:vi.fn(),getConnection:vi.fn().mockResolvedValue(connection)});
    const result=await repository.persist(9,7,{id:2,model_name:'vision'},{is_pickup_message:true,matched_station_id:3,station_name:'东门',station_address:'',pickup_codes:['A-1','A-10','A-1'],courier_name:'',pickup_time:'',confidence:1},{recognitionSource:'ai',fallbackReason:''});
    expect(result).toMatchObject({status:'created',codes:['A-10'],duplicate_codes:['A-1']});
    const inserts=execute.mock.calls.filter(([sql])=>String(sql).includes('INSERT INTO parcels'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]).toContain('A-10');
    expect(execute.mock.calls.some(([sql])=>String(sql).includes('SELECT id FROM users WHERE id=? FOR UPDATE'))).toBe(true);
    expect(execute.mock.calls.some(([sql])=>String(sql).includes('BINARY pickup_code IN'))).toBe(true);
    expect(execute.mock.calls.every(([sql])=>!String(sql).includes('INSERT IGNORE INTO parcels'))).toBe(true);
  });
});
