import type { ResultSetHeader } from 'mysql2/promise';
import type { ClaimedImageJob, RecognitionWorkerRepository } from './recognition.js';
import type { RecognitionErrorType } from '../modules/recognition/errors.js';

interface WorkerConnection { execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>; beginTransaction(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>; release(): void }
export interface RecognitionWorkerPool { execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>; getConnection(): Promise<WorkerConnection> }

export class MysqlRecognitionWorkerRepository implements RecognitionWorkerRepository {
  constructor(private readonly pool: RecognitionWorkerPool) {}
  async claim(workerId: string, leaseSeconds: number): Promise<ClaimedImageJob | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT id,message_id,user_id,upload_path,mime_type,attempt_count FROM recognition_jobs WHERE kind='image' AND ((status='pending' AND next_attempt_at<=NOW()) OR (status='processing' AND lease_expires_at<NOW())) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      const job = (rows as ClaimedImageJob[])[0];
      if (!job) { await connection.commit(); return null; }
      const [result] = await connection.execute("UPDATE recognition_jobs SET status='processing',attempt_count=attempt_count+1,lease_owner=?,lease_expires_at=DATE_ADD(NOW(),INTERVAL ? SECOND),started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=?", [workerId, leaseSeconds, job.id]);
      if ((result as ResultSetHeader).affectedRows !== 1) throw new Error('识别任务认领失败');
      await connection.commit();
      return { ...job, attempt_count: job.attempt_count + 1 };
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  async complete(jobId: number): Promise<void> {
    await this.pool.execute("UPDATE recognition_jobs SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW() WHERE id=? AND status='processing'", [jobId]);
  }
  async fail(jobId: number, messageId: number, error: string, retry: boolean, errorType: RecognitionErrorType = 'internal'): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("UPDATE recognition_jobs SET status=?,next_attempt_at=IF(?,DATE_ADD(NOW(),INTERVAL 12 SECOND),next_attempt_at),lease_owner=NULL,lease_expires_at=NULL,last_error=?,completed_at=IF(?,completed_at,NOW()),updated_at=NOW() WHERE id=? AND status='processing'", [retry ? 'pending' : 'failed', retry ? 1 : 0, error.slice(0, 500), retry ? 1 : 0, jobId]);
      await connection.execute("UPDATE incoming_messages SET ai_status=?,parse_status='needs_review',ai_error=IF(?,'AI超时，等待重试',?),ai_processed_at=NOW(),ai_attempts=ai_attempts+1 WHERE id=?", [retry ? 'pending' : 'failed', retry && errorType === 'provider_transient' ? 1 : 0, error.slice(0, 500), messageId]);
      console.info(JSON.stringify({service:'qujianma-recognition-worker',event:'attempt_finished',jobId,messageId,errorType,retry}));
      await connection.commit();
    } catch (failure) { await connection.rollback(); throw failure; } finally { connection.release(); }
  }
}
