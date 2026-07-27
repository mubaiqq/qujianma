import { describe, expect, it, vi } from 'vitest';
import { ShareUnavailableError, SharingService } from '../../../src/modules/sharing/service.js';

const now = new Date('2026-07-25T10:00:00.000Z');
function fixture() {
  const repository = {
    findActive: vi.fn(), listPendingParcelIds: vi.fn(), create: vi.fn(), revokeActive: vi.fn(),
    findPublic: vi.fn(), markPublicParcelPicked: vi.fn(),
  };
  const crypto = { randomToken: vi.fn(()=> 'raw-token'), hashToken: vi.fn(()=> 'token-hash'), encryptToken: vi.fn(()=> 'cipher'), decryptToken: vi.fn(()=> 'raw-token') };
  return { repository, crypto, service: new SharingService(repository, crypto, { baseUrl:'https://pickup.test', now:()=>now }) };
}

describe('SharingService',()=>{
  it('reuses an active unexpired share only for its owner',async()=>{const x=fixture();x.repository.findActive.mockResolvedValue({id:4,userId:7,tokenCiphertext:'cipher',expiresAt:new Date(now.getTime()+1000),pendingCount:2});expect(await x.service.createOrReuse(7)).toMatchObject({active:true,url:'https://pickup.test/share?t=raw-token',pending_count:2});expect(x.repository.create).not.toHaveBeenCalled();expect(x.repository.findActive).toHaveBeenCalledWith(7,now);});
  it('regenerates a 24 hour link from the owner pending parcels',async()=>{const x=fixture();x.repository.listPendingParcelIds.mockResolvedValue([11,12]);x.repository.create.mockResolvedValue(8);const result=await x.service.regenerate(7);expect(x.repository.revokeActive).toHaveBeenCalledWith(7,now);expect(x.repository.create).toHaveBeenCalledWith(expect.objectContaining({userId:7,tokenHash:'token-hash',tokenCiphertext:'cipher',parcelIds:[11,12],expiresAt:new Date('2026-07-26T10:00:00.000Z')}));expect(result.pending_count).toBe(2);});
  it('rejects sharing when the owner has no pending parcels',async()=>{const x=fixture();x.repository.listPendingParcelIds.mockResolvedValue([]);await expect(x.service.regenerate(7)).rejects.toBeInstanceOf(ShareUnavailableError);});
  it('queries and marks public parcels through a token hash without exposing raw token to storage',async()=>{const x=fixture();x.repository.findPublic.mockResolvedValue({expiresAt:new Date(now.getTime()+1000),items:[{id:11,pickup_code:'A1'}]});x.repository.markPublicParcelPicked.mockResolvedValue(true);expect(await x.service.getPublic(' raw-token ')).toMatchObject({items:[{id:11}]});expect(x.repository.findPublic).toHaveBeenCalledWith('token-hash',now);await x.service.markPublicPicked('raw-token',11);expect(x.repository.markPublicParcelPicked).toHaveBeenCalledWith('token-hash',11,now);});
});
