/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { IngestService, normalizeSmsText, type IngestRepository } from '../../../src/modules/ingest/service.js';

function repository(overrides:Partial<IngestRepository>={}):IngestRepository { return { authenticate:vi.fn().mockResolvedValue({userId:7}), findDuplicate:vi.fn().mockResolvedValue(null), claimStalePending:vi.fn().mockResolvedValue(false), insert:vi.fn().mockResolvedValue(11), findDuplicateAfterConflict:vi.fn().mockResolvedValue(null), markFailed:vi.fn(), ...overrides }; }
describe('IngestService',()=>{
  it('authenticates both token kinds by hash and persists a user-scoped fingerprint before AI',async()=>{
    const repo=repository(); const ai={process:vi.fn().mockResolvedValue({status:'created' as const,codes:['A-1']})};
    const result=await new IngestService(repo,ai,{hashToken:()=> 'hash'},()=>new Date('2026-07-25T12:34:56Z')).ingest('secret',{message:'  A：1  ',sender:'86100',receivedAt:'2026-07-24T20:15:00+08:00'},'127.0.0.1');
    expect(repo.authenticate).toHaveBeenCalledWith('hash'); expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({userId:7,sender:'+86100',rawMessage:'A：1',receivedAt:'2026-07-24 20:15:00'}));
    expect(ai.process).toHaveBeenCalledWith(11,7); expect(result.status).toBe('created');
  });
  it('returns duplicate and does not invoke AI',async()=>{ const repo=repository({findDuplicate:vi.fn().mockResolvedValue({messageId:5,aiStatus:'success'})}); const ai={process:vi.fn()}; const result=await new IngestService(repo,ai,{hashToken:()=> 'h'}).ingest('t',{message:'same'},''); expect(result).toEqual({status:'duplicate',messageId:5,aiStatus:'success'}); expect(ai.process).not.toHaveBeenCalled(); });
  it('atomically reclaims a stale pending duplicate and processes it once',async()=>{ const repo=repository({findDuplicate:vi.fn().mockResolvedValue({messageId:5,aiStatus:'pending'}),claimStalePending:vi.fn().mockResolvedValue(true)}); const ai={process:vi.fn().mockResolvedValue({status:'created' as const,codes:['A-1']})}; const result=await new IngestService(repo,ai,{hashToken:()=> 'h'}).ingest('t',{message:'same'},''); expect(repo.claimStalePending).toHaveBeenCalledWith(7,5); expect(ai.process).toHaveBeenCalledTimes(1); expect(result).toMatchObject({status:'created',messageId:5}); });
  it('marks an inserted message failed when recognition unexpectedly throws',async()=>{ const repo=repository(); const ai={process:vi.fn().mockRejectedValue(new Error('secret-key=abc'))}; const result=await new IngestService(repo,ai,{hashToken:()=> 'h'}).ingest('t',{message:'same'},''); expect(repo.markFailed).toHaveBeenCalledWith(11,7,expect.not.stringContaining('abc')); expect(result).toMatchObject({status:'failed',messageId:11,aiStatus:'failed'}); });
  it('normalizes legacy punctuation and invisible characters for fingerprints',()=>expect(normalizeSmsText('\u200b A：  B\r')).toBe('A: B'));
});
