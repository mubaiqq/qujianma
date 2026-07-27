import type { RowDataPacket } from 'mysql2/promise';
import type { ApiTokenRecord, ApiTokenRepository } from './service.js';
export interface TokenConnection { execute(sql:string,values?:unknown[]):Promise<[unknown,unknown]>;beginTransaction():Promise<void>;commit():Promise<void>;rollback():Promise<void>;release():void }
export interface TokenPool { execute(sql:string,values?:unknown[]):Promise<[unknown,unknown]>;getConnection():Promise<TokenConnection> }
export class MysqlApiTokenRepository implements ApiTokenRepository {
 constructor(private readonly pool:TokenPool){}
 async findLatestActive(userId:number){const [rows]=await this.pool.execute('SELECT id,name,token_ciphertext,token_prefix,last_used_at,created_at FROM api_tokens WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1',[userId]);const r=(rows as RowDataPacket[])[0];return r?{id:Number(r.id),name:String(r.name),tokenCiphertext:String(r.token_ciphertext),tokenPrefix:String(r.token_prefix),lastUsedAt:r.last_used_at?new Date(r.last_used_at as string|Date):null,createdAt:new Date(r.created_at as string|Date)}:null;}
 async regenerate(v:ApiTokenRecord){const c=await this.pool.getConnection();try{await c.beginTransaction();await c.execute('UPDATE api_tokens SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL',[v.userId]);await c.execute('INSERT INTO api_tokens(user_id,name,token_hash,token_ciphertext,token_prefix) VALUES(?,?,?,?,?)',[v.userId,v.name,v.tokenHash,v.tokenCiphertext,v.tokenPrefix]);await c.commit();}catch(e){await c.rollback().catch(()=>undefined);throw e;}finally{c.release();}}
}
