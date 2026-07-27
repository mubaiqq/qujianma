export interface ActiveShare { id:number; userId:number; tokenCiphertext:string|null; expiresAt:Date; pendingCount:number }
export interface PublicShare { expiresAt:Date; items:Array<Record<string,unknown>&{id:number}> }
export interface CreateShare { userId:number; tokenHash:string; tokenCiphertext:string; expiresAt:Date; parcelIds:number[] }
export interface SharingRepository {
  findActive(userId:number,now:Date):Promise<ActiveShare|null>;
  listPendingParcelIds(userId:number):Promise<number[]>;
  create(record:CreateShare):Promise<number>;
  revokeActive(userId:number,now:Date):Promise<void>;
  findPublic(tokenHash:string,now:Date):Promise<PublicShare|null>;
  markPublicParcelPicked(tokenHash:string,parcelId:number,now:Date):Promise<boolean>;
}
export interface ShareTokenCrypto { randomToken():string; hashToken(token:string):string; encryptToken(token:string):string; decryptToken(ciphertext:string):string }
export interface ShareStatus { active:boolean; url:string; expires_at:string|null; pending_count:number }
export class ShareUnavailableError extends Error {}
export class ShareNotFoundError extends Error {}

export class SharingService {
  private readonly now:()=>Date;
  constructor(private readonly repository:SharingRepository,private readonly crypto:ShareTokenCrypto,private readonly options:{baseUrl:string;now?:()=>Date}) { this.now=options.now??(()=>new Date()); }
  async status(userId:number):Promise<ShareStatus> { const now=this.now(); const active=await this.repository.findActive(userId,now); return this.present(active); }
  async createOrReuse(userId:number):Promise<ShareStatus> { const now=this.now(); const active=await this.repository.findActive(userId,now); if(active) { const result=this.present(active); if(result.active) return result; } return this.regenerate(userId); }
  async regenerate(userId:number):Promise<ShareStatus> { const now=this.now(); await this.repository.revokeActive(userId,now); const parcelIds=await this.repository.listPendingParcelIds(userId); if(parcelIds.length===0) throw new ShareUnavailableError('当前没有待取件可分享'); const token=this.crypto.randomToken(); const expiresAt=new Date(now.getTime()+86_400_000); await this.repository.create({userId,tokenHash:this.crypto.hashToken(token),tokenCiphertext:this.crypto.encryptToken(token),expiresAt,parcelIds}); return {active:true,url:this.url(token),expires_at:expiresAt.toISOString(),pending_count:parcelIds.length}; }
  async cancel(userId:number):Promise<void> { await this.repository.revokeActive(userId,this.now()); }
  async getPublic(rawToken:string):Promise<PublicShare> { const token=rawToken.trim(); if(token==='') throw new ShareNotFoundError('分享链接无效'); const result=await this.repository.findPublic(this.crypto.hashToken(token),this.now()); if(!result) throw new ShareNotFoundError('分享链接已失效'); return result; }
  async markPublicPicked(rawToken:string,parcelId:number):Promise<void> { const token=rawToken.trim(); if(token===''||!Number.isSafeInteger(parcelId)||parcelId<1) throw new ShareNotFoundError('分享链接无效'); if(!await this.repository.markPublicParcelPicked(this.crypto.hashToken(token),parcelId,this.now())) throw new ShareNotFoundError('取件码不存在、已取或链接已失效'); }
  private present(active:ActiveShare|null):ShareStatus { if(!active||active.pendingCount<1||!active.tokenCiphertext) return {active:false,url:'',expires_at:null,pending_count:0}; const token=this.crypto.decryptToken(active.tokenCiphertext); if(token==='') return {active:false,url:'',expires_at:null,pending_count:0}; return {active:true,url:this.url(token),expires_at:active.expiresAt.toISOString(),pending_count:active.pendingCount}; }
  private url(token:string):string { return `${this.options.baseUrl.replace(/\/$/,'')}/share?t=${encodeURIComponent(token)}`; }
}
