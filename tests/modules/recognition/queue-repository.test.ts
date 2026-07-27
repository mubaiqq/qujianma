/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';
import { MysqlImageQueueRepository, type QueueConnection, type QueuePool } from '../../../src/modules/recognition/queue-repository.js';

function connection(execute=vi.fn()): QueueConnection { return { execute, beginTransaction:vi.fn(), commit:vi.fn(), rollback:vi.fn(), release:vi.fn() }; }
describe('MysqlImageQueueRepository',()=>{
  it('requeues with NOT NULL-safe empty errors and resets stale result state',async()=>{ const execute=vi.fn().mockResolvedValue([{affectedRows:1},[]]); const pool={execute,getConnection:vi.fn()} as unknown as QueuePool; await expect(new MysqlImageQueueRepository(pool).requeueImage(7,8)).resolves.toBe(true); const sql=String(execute.mock.calls[0]?.[0]); expect(sql).toContain("m.ai_error=''"); expect(sql).toContain('m.ai_result_json=NULL'); expect(sql).not.toContain('m.ai_error=NULL'); });
  it('uses one bounded advisory-lock name and releases it on the same connection',async()=>{ const execute=vi.fn().mockResolvedValueOnce([[{acquired:1}],[]]).mockResolvedValueOnce([[{id:12,ai_status:'processing',status:'processing',upload_path:'7/old.jpg'}],[]]).mockResolvedValueOnce([[],[]]); const c=connection(execute); const pool={execute:vi.fn(),getConnection:vi.fn().mockResolvedValue(c)} as unknown as QueuePool; const result=await new MysqlImageQueueRepository(pool).enqueueImage(123456789,{uploadPath:'7/new.jpg',mime:'image/jpeg',size:3,fingerprint:'a'.repeat(64),clientIp:''}); expect(result).toEqual({messageId:12,disposition:'duplicate',aiStatus:'processing'}); const lockName=String(execute.mock.calls[0]?.[1]?.[0]); expect(lockName.length).toBeLessThanOrEqual(64); expect(lockName).toMatch(/^image:[a-f0-9]{48}$/); expect(execute).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?)',[lockName]); expect(execute.mock.calls.some(call=>String(call[0]).startsWith('INSERT INTO incoming_messages'))).toBe(false); expect(c.commit).toHaveBeenCalled(); expect(c.release).toHaveBeenCalledOnce(); });
  it('releases the bounded advisory lock when enqueue fails',async()=>{ const execute=vi.fn().mockResolvedValueOnce([[{acquired:1}],[]]).mockRejectedValueOnce(new Error('select failed')).mockResolvedValueOnce([[],[]]); const c=connection(execute); const pool={execute:vi.fn(),getConnection:vi.fn().mockResolvedValue(c)} as unknown as QueuePool; await expect(new MysqlImageQueueRepository(pool).enqueueImage(7,{uploadPath:'7/new.jpg',mime:'image/jpeg',size:3,fingerprint:'b'.repeat(64),clientIp:''})).rejects.toThrow('select failed'); const lockName=String(execute.mock.calls[0]?.[1]?.[0]); expect(execute).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?)',[lockName]); expect(c.rollback).toHaveBeenCalled(); expect(c.release).toHaveBeenCalledOnce(); });
  it('keeps concurrent identical enqueues idempotent',async()=>{
    let messageId:number|undefined; let nextId=40; let lock:Promise<void>=Promise.resolve();
    const pool:QueuePool={execute:vi.fn(),getConnection:vi.fn(async()=>{
      let unlock=()=>{};
      return connection(vi.fn(async(sql:string)=>{
        if(sql.includes('GET_LOCK')){const previous=lock;lock=new Promise<void>(resolve=>{unlock=resolve;});await previous;return [[{acquired:1}],[]];}
        if(sql.includes('RELEASE_LOCK')){unlock();return [[],[]];}
        if(sql.startsWith('SELECT m.id'))return [messageId===undefined?[]:[{id:messageId,ai_status:'pending',status:'pending',upload_path:'7/original.jpg'}],[]];
        if(sql.startsWith('INSERT INTO incoming_messages')){messageId=++nextId;return [{insertId:messageId},[]];}
        return [[],[]];
      }));
    })};
    const repository=new MysqlImageQueueRepository(pool),input={uploadPath:'7/new.jpg',mime:'image/jpeg',size:3,fingerprint:'c'.repeat(64),clientIp:''};
    const results=await Promise.all([repository.enqueueImage(7,input),repository.enqueueImage(7,input)]);
    expect(results.map(result=>result.messageId)).toEqual([41,41]); expect(results.map(result=>result.disposition).sort()).toEqual(['duplicate','queued']); expect(pool.getConnection).toHaveBeenCalledTimes(2);
  });
  it('keeps a failed existing upload as history instead of creating a replacement',async()=>{ const execute=vi.fn().mockResolvedValueOnce([[{acquired:1}],[]]).mockResolvedValueOnce([[{id:13,ai_status:'failed',status:'failed',upload_path:'7/old.jpg'}],[]]).mockResolvedValueOnce([[],[]]); const c=connection(execute); const pool={execute:vi.fn(),getConnection:vi.fn().mockResolvedValue(c)} as unknown as QueuePool; await expect(new MysqlImageQueueRepository(pool).enqueueImage(7,{uploadPath:'7/new.jpg',mime:'image/jpeg',size:3,fingerprint:'abc',clientIp:''})).resolves.toEqual({messageId:13,disposition:'failed_history',aiStatus:'failed'}); });
});