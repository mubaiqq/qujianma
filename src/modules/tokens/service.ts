import { randomBytes } from 'node:crypto';

export interface ApiTokenRow { id:number; name:string; tokenCiphertext:string; tokenPrefix:string; lastUsedAt:Date|null; createdAt:Date }
export interface ApiTokenRecord { userId:number; name:string; tokenHash:string; tokenCiphertext:string; tokenPrefix:string }
export interface ApiTokenRepository { findLatestActive(userId:number):Promise<ApiTokenRow|null>; regenerate(record:ApiTokenRecord):Promise<void> }
export interface TokenCrypto { generate():string; hash(value:string):string; encrypt(value:string):string; decrypt(value:string):string; baseUrl:string }

export class ApiTokenService {
  constructor(private readonly repository:ApiTokenRepository, private readonly crypto:TokenCrypto) {}
  async get(userId:number) {
    const row=await this.repository.findLatestActive(userId);
    if(!row)return this.regenerate(userId);
    const token=this.crypto.decrypt(row.tokenCiphertext);
    return { id:row.id,name:row.name,token_prefix:row.tokenPrefix,last_used_at:row.lastUsedAt,created_at:row.createdAt,token,url:this.url(token) };
  }
  async regenerate(userId:number) {
    const token=this.crypto.generate();
    await this.repository.regenerate({userId,name:'我的 iPhone',tokenHash:this.crypto.hash(token),tokenCiphertext:this.crypto.encrypt(token),tokenPrefix:token.slice(0,8)});
    return {url:this.url(token),token};
  }
  private url(token:string){return `${this.crypto.baseUrl.replace(/\/$/,'')}/api/ingest?k=${encodeURIComponent(token)}`;}
}
export const randomApiToken=()=>randomBytes(24).toString('hex');
