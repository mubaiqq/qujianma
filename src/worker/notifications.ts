export interface WorkerCandidate { userId: number; pendingCount: number }
export interface OverdueCandidate { userId: number; maxHours: number }
export interface NotificationWorkerRepository {
  acquireLock(name: string, timeoutSeconds: number): Promise<boolean>;
  releaseLock(name: string): Promise<void>;
  eligibleDaily(now: Date): Promise<WorkerCandidate[]>;
  eligibleOverdue(now: Date): Promise<OverdueCandidate[]>;
  markDailySent(userId: number, now: Date): Promise<void>;
  markOverdueSent(userId: number, now: Date): Promise<void>;
  heartbeat(state: { status: 'running' | 'succeeded' | 'failed'; at: Date; attempt: number; error?: string }): Promise<void>;
  recordFailure(userId: number, kind: 'daily' | 'overdue', error: string, nextRetryAt: Date): Promise<void>;
}
export interface WorkerPush {
  sendDaily(userId: number, total: number): Promise<{ sent: number; failed: number }>;
  sendOverdue(userId: number, hours: 24 | 48 | 72): Promise<{ sent: number; failed: number }>;
}

const shanghaiHour = (date: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(date));
const stage = (hours: number): 24 | 48 | 72 => hours >= 72 ? 72 : hours >= 48 ? 48 : 24;
const message = (error: unknown) => error instanceof Error ? error.message : '推送发送失败';

export async function runNotificationWorker(
  repository: NotificationWorkerRepository,
  push: WorkerPush,
  options: { now?: () => Date; attempt?: number; lockName?: string } = {},
) {
  const now = (options.now ?? (() => new Date()))();
  const attempt = options.attempt ?? 1;
  const lockName = options.lockName ?? 'pickup-notification-worker';
  if (!await repository.acquireLock(lockName, 0)) return { status: 'skipped' as const, dailySent: 0, overdueSent: 0, failed: 0 };

  let dailySent = 0;
  let overdueSent = 0;
  let failed = 0;
  try {
    await repository.heartbeat({ status: 'running', at: now, attempt });
    for (const candidate of await repository.eligibleDaily(now)) {
      try {
        const result = await push.sendDaily(candidate.userId, candidate.pendingCount);
        if (result.sent > 0) {
          dailySent += result.sent;
          await repository.markDailySent(candidate.userId, now);
        }
        if (result.failed > 0) {
          failed += result.failed;
          await repository.recordFailure(candidate.userId, 'daily', '推送发送失败', new Date(now.getTime() + attempt * 300_000));
        }
      } catch (error) {
        failed++;
        await repository.recordFailure(candidate.userId, 'daily', message(error), new Date(now.getTime() + attempt * 300_000));
      }
    }
    if (shanghaiHour(now) >= 18) {
      for (const candidate of await repository.eligibleOverdue(now)) {
        try {
          const result = await push.sendOverdue(candidate.userId, stage(candidate.maxHours));
          if (result.sent > 0) {
            overdueSent += result.sent;
            await repository.markOverdueSent(candidate.userId, now);
          }
          if (result.failed > 0) {
            failed += result.failed;
            await repository.recordFailure(candidate.userId, 'overdue', '推送发送失败', new Date(now.getTime() + attempt * 300_000));
          }
        } catch (error) {
          failed++;
          await repository.recordFailure(candidate.userId, 'overdue', message(error), new Date(now.getTime() + attempt * 300_000));
        }
      }
    }
    if (failed > 0) {
      await repository.heartbeat({ status: 'failed', at: new Date(), attempt, error: `${failed} push delivery failure(s)` });
      return { status: 'failed' as const, dailySent, overdueSent, failed };
    }
    await repository.heartbeat({ status: 'succeeded', at: new Date(), attempt });
    return { status: 'succeeded' as const, dailySent, overdueSent, failed };
  } catch (error) {
    await repository.heartbeat({ status: 'failed', at: new Date(), attempt, error: message(error) });
    return { status: 'failed' as const, dailySent, overdueSent, failed: failed + 1 };
  } finally {
    await repository.releaseLock(lockName);
  }
}
