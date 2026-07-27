import { createHash } from 'node:crypto';
import type { ResultSetHeader } from 'mysql2/promise';
import type { ImageQueueRepository, QueueImageInput, RetryableImage } from './queue.js';

export interface QueueConnection { execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>; beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>; release(): void }
export interface QueuePool { execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>; getConnection(): Promise<QueueConnection> }

export class MysqlImageQueueRepository implements ImageQueueRepository {
  constructor(private readonly pool: QueuePool) {}
  async enqueueImage(userId: number, input: QueueImageInput): Promise<{messageId:number;disposition:'queued'|'duplicate'|'failed_history';aiStatus?:string}> {
    const connection = await this.pool.getConnection();
    const lockName = `image:${createHash('sha256').update(`image:${userId}:${input.fingerprint}`).digest('hex').slice(0,48)}`;
    let lockAcquired = false;
    try {
      await connection.beginTransaction();
      const [lockRows] = await connection.execute('SELECT GET_LOCK(?,10) acquired',[lockName]);
      lockAcquired = Number((lockRows as { acquired: number }[])[0]?.acquired) === 1;
      if (!lockAcquired) throw new Error('Unable to acquire image enqueue lock');
      const [rows]=await connection.execute("SELECT m.id,m.ai_status,j.status,j.upload_path FROM incoming_messages m JOIN recognition_jobs j ON j.message_id=m.id AND j.user_id=m.user_id AND j.kind='image' WHERE m.user_id=? AND m.request_fingerprint=? ORDER BY m.id LIMIT 1 FOR UPDATE",[userId,input.fingerprint]);
      const existing=(rows as {id:number;ai_status:string;status:string;upload_path:string}[])[0];
      if(existing){await connection.commit();return {messageId:existing.id,disposition:['failed','no_config'].includes(existing.ai_status)||existing.status==='failed'?'failed_history':'duplicate',aiStatus:existing.ai_status};}
      const [message] = await connection.execute("INSERT INTO incoming_messages(user_id,sender,raw_sender,raw_message,received_at,request_fingerprint,parse_status,ai_status,client_ip) VALUES(?,'图片识别','图片识别','[图片等待识别]',NOW(),?,'needs_review','pending',?)", [userId, input.fingerprint, input.clientIp]);
      const messageId = (message as ResultSetHeader).insertId;
      await connection.execute("INSERT INTO recognition_jobs(message_id,user_id,kind,upload_path,mime_type,file_size,status,next_attempt_at) VALUES(?,?,'image',?,?,?,'pending',NOW())", [messageId, userId, input.uploadPath, input.mime, input.size]);
      await connection.commit();
      return {messageId,disposition:'queued'};
    } catch (error) { await connection.rollback(); throw error; } finally {
      try { if (lockAcquired) await connection.execute('SELECT RELEASE_LOCK(?)',[lockName]); }
      finally { connection.release(); }
    }
  }
  async imageForRetry(userId: number, messageId: number): Promise<RetryableImage | null> {
    const [rows] = await this.pool.execute("SELECT m.id,j.upload_path,m.ai_status FROM incoming_messages m JOIN recognition_jobs j ON j.message_id=m.id AND j.user_id=m.user_id AND j.kind='image' WHERE m.id=? AND m.user_id=? LIMIT 1", [messageId, userId]);
    return (rows as RetryableImage[])[0] ?? null;
  }
  async requeueImage(userId: number, messageId: number): Promise<boolean> {
    const [result] = await this.pool.execute("UPDATE recognition_jobs j JOIN incoming_messages m ON m.id=j.message_id AND m.user_id=j.user_id SET j.status='pending',j.attempt_count=0,j.next_attempt_at=NOW(),j.lease_owner=NULL,j.lease_expires_at=NULL,j.last_error=NULL,j.started_at=NULL,j.completed_at=NULL,m.ai_status='pending',m.parse_status='needs_review',m.ai_error='',m.ai_result_json=NULL,m.ai_processed_at=NULL WHERE j.message_id=? AND j.user_id=? AND j.kind='image' AND j.status='failed' AND m.ai_status IN ('failed','no_config')", [messageId, userId]);
    return (result as ResultSetHeader).affectedRows === 1;
  }
  async deleteFailedImage(userId: number, messageId: number): Promise<{ deleted: boolean; uploadPath: string | null }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT j.upload_path FROM incoming_messages m JOIN recognition_jobs j ON j.message_id=m.id AND j.user_id=m.user_id WHERE m.id=? AND m.user_id=? AND j.kind='image' AND j.status='failed' AND m.ai_status IN ('failed','no_config','not_pickup') FOR UPDATE", [messageId, userId]);
      const row = (rows as { upload_path: string }[])[0];
      if (!row) { await connection.rollback(); return { deleted: false, uploadPath: null }; }
      await connection.execute('DELETE FROM parcels WHERE message_id=? AND user_id=?', [messageId, userId]);
      await connection.execute('DELETE FROM incoming_messages WHERE id=? AND user_id=?', [messageId, userId]);
      await connection.commit();
      return { deleted: true, uploadPath: row.upload_path };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
}
