import type { RowDataPacket } from 'mysql2/promise';
import type { NotificationWorkerRepository, OverdueCandidate, WorkerCandidate } from './notifications.js';

export interface WorkerSqlConnection {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
  release(): void;
}
export interface WorkerSqlPool {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
  getConnection(): Promise<WorkerSqlConnection>;
}

export class MysqlNotificationWorkerRepository implements NotificationWorkerRepository {
  private lockConnection: WorkerSqlConnection | undefined;

  constructor(private readonly pool: WorkerSqlPool) {}

  async acquireLock(name: string, timeout: number) {
    if (this.lockConnection) throw new Error('Worker advisory lock is already held');
    const connection = await this.pool.getConnection();
    try {
      const [rows] = await connection.execute('SELECT GET_LOCK(?,?) acquired', [name, timeout]);
      const acquired = Number((rows as RowDataPacket[])[0]?.acquired) === 1;
      if (acquired) this.lockConnection = connection;
      else connection.release();
      return acquired;
    } catch (error) {
      connection.release();
      throw error;
    }
  }

  async releaseLock(name: string) {
    const connection = this.lockConnection;
    if (!connection) return;
    this.lockConnection = undefined;
    try {
      await connection.execute('SELECT RELEASE_LOCK(?)', [name]);
    } finally {
      connection.release();
    }
  }

  async eligibleDaily(now: Date) {
    const [rows] = await this.pool.execute("SELECT np.user_id,(SELECT COUNT(*) FROM parcels p WHERE p.user_id=np.user_id AND p.status='pending') pending_count FROM notification_preferences np WHERE np.daily_enabled=1 AND np.daily_time<=TIME(CONVERT_TZ(?, '+00:00', np.timezone)) AND (np.last_daily_sent_date IS NULL OR np.last_daily_sent_date<DATE(CONVERT_TZ(?, '+00:00', np.timezone))) AND EXISTS(SELECT 1 FROM push_subscriptions ps WHERE ps.user_id=np.user_id) HAVING pending_count>0", [now, now]);
    return (rows as RowDataPacket[]).map((row) => ({ userId: Number(row.user_id), pendingCount: Number(row.pending_count) } satisfies WorkerCandidate));
  }

  async eligibleOverdue(now: Date) {
    const [rows] = await this.pool.execute("SELECT np.user_id,MAX(TIMESTAMPDIFF(HOUR,p.received_at,?)) max_hours FROM notification_preferences np JOIN parcels p ON p.user_id=np.user_id AND p.status='pending' WHERE np.new_pending_enabled=1 AND (np.last_overdue_sent_date IS NULL OR np.last_overdue_sent_date<DATE(CONVERT_TZ(?, '+00:00', np.timezone))) AND EXISTS(SELECT 1 FROM push_subscriptions ps WHERE ps.user_id=np.user_id) GROUP BY np.user_id HAVING max_hours>=24", [now, now]);
    return (rows as RowDataPacket[]).map((row) => ({ userId: Number(row.user_id), maxHours: Number(row.max_hours) } satisfies OverdueCandidate));
  }

  async markDailySent(userId: number, now: Date) {
    await this.pool.execute("UPDATE notification_preferences SET last_daily_sent_date=DATE(CONVERT_TZ(?,'+00:00',timezone)) WHERE user_id=?", [now, userId]);
  }

  async markOverdueSent(userId: number, now: Date) {
    await this.pool.execute("UPDATE notification_preferences SET last_overdue_sent_date=DATE(CONVERT_TZ(?,'+00:00',timezone)) WHERE user_id=?", [now, userId]);
  }

  async heartbeat(state: { status: 'running' | 'succeeded' | 'failed'; at: Date; attempt: number; error?: string }) {
    await this.pool.execute("INSERT INTO worker_status(worker_name,status,heartbeat_at,attempt_count,last_error) VALUES('notifications',?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),heartbeat_at=VALUES(heartbeat_at),attempt_count=VALUES(attempt_count),last_error=VALUES(last_error)", [state.status, state.at, state.attempt, state.error ?? '']);
  }

  async recordFailure(userId: number, kind: 'daily' | 'overdue', error: string, nextRetryAt: Date) {
    await this.pool.execute("INSERT INTO worker_failures(worker_name,user_id,job_kind,error_message,next_retry_at,status) VALUES('notifications',?,?,?,?, 'retrying') ON DUPLICATE KEY UPDATE error_message=VALUES(error_message),next_retry_at=VALUES(next_retry_at),status='retrying',attempt_count=attempt_count+1", [userId, kind, error.slice(0, 500), nextRetryAt]);
  }
}
