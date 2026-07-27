import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { IngestRecord, IngestRepository } from './service.js';
export interface IngestSqlPool { execute(sql:string,values?:unknown[]):Promise<[unknown,unknown]> }
interface AuthRow extends RowDataPacket { token_id:number;user_id:number }
interface ExistingRow extends RowDataPacket { id:number;ai_status:string }
export class MysqlIngestRepository implements IngestRepository {
 constructor(private readonly pool:IngestSqlPool){}
 async authenticate(hash:string) { let [rows]=await this.pool.execute('SELECT t.id token_id,t.user_id FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.revoked_at IS NULL LIMIT 1',[hash]); let row=(rows as AuthRow[])[0]; if(row){await this.pool.execute('UPDATE api_tokens SET last_used_at=NOW() WHERE id=?',[row.token_id]);return {userId:row.user_id};} [rows]=await this.pool.execute('SELECT d.id token_id,d.user_id FROM app_devices d JOIN users u ON u.id=d.user_id WHERE d.token_hash=? AND d.revoked_at IS NULL LIMIT 1',[hash]); row=(rows as AuthRow[])[0]; if(!row)return null; await this.pool.execute('UPDATE app_devices SET last_used_at=NOW(),last_seen_at=NOW() WHERE id=?',[row.token_id]); return {userId:row.user_id}; }
 async findDuplicate(userId:number,fingerprint:string) { return this.existing(userId,fingerprint); }
 async findDuplicateAfterConflict(userId:number,fingerprint:string) { return this.existing(userId,fingerprint); }
 async claimStalePending(userId:number,messageId:number) { const [result]=await this.pool.execute("UPDATE incoming_messages SET ai_attempts=ai_attempts+1,ai_processed_at=NOW() WHERE id=? AND user_id=? AND ai_status='pending' AND ai_attempts=0 AND created_at<=DATE_SUB(NOW(),INTERVAL 2 MINUTE)",[messageId,userId]); return (result as ResultSetHeader).affectedRows===1; }
 private async existing(userId:number,fingerprint:string) { const [rows]=await this.pool.execute('SELECT id,ai_status FROM incoming_messages WHERE user_id=? AND request_fingerprint=?',[userId,fingerprint]); const row=(rows as ExistingRow[])[0]; return row?{messageId:row.id,aiStatus:row.ai_status}:null; }
 async insert(r:IngestRecord) { const [result]=await this.pool.execute("INSERT INTO incoming_messages(user_id,sender,raw_sender,raw_message,received_at,request_fingerprint,parse_status,ai_status,client_ip) VALUES(?,?,?,?,?,?,'needs_review','pending',?)",[r.userId,r.sender,r.rawSender,r.rawMessage,r.receivedAt,r.fingerprint,r.clientIp]); return (result as ResultSetHeader).insertId; }
 async markFailed(messageId:number,userId:number,error:string) { await this.pool.execute("UPDATE incoming_messages SET ai_status='failed',parse_status='needs_review',ai_error=?,ai_processed_at=NOW(),ai_attempts=ai_attempts+1 WHERE id=? AND user_id=? AND ai_status='pending'",[error.slice(0,500),messageId,userId]); }
}
