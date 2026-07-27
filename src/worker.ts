import 'dotenv/config';
import { NotificationService } from './modules/notifications/service.js';
import { MysqlNotificationRepository } from './modules/notifications/repository.js';
import { loadConfig } from './platform/config.js';
import { createDatabase } from './platform/database.js';
import { createPushSender } from './platform/push-sender.js';
import { runNotificationWorker } from './worker/notifications.js';
import { NotificationWorkerPush } from './worker/push.js';
import { MysqlNotificationWorkerRepository } from './worker/repository.js';
import { runWorkerLoop } from './worker/runtime.js';

const service = 'qujianma-node-worker';
const log = (level: 'info' | 'error', event: string, details: Record<string, unknown> = {}) => {
  const output = JSON.stringify({ level, service, event, ...details });
  if (level === 'error') console.error(output);
  else console.info(output);
};

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  process.env.TZ = config.TZ;
  if (!config.WORKER_ENABLED) {
    log('info', 'worker_disabled', { version: config.APP_VERSION });
    return;
  }

  const database = createDatabase(config);
  const abort = new AbortController();
  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    log('info', 'shutdown_requested', { signal });
    abort.abort();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await database.write.query('SELECT 1');
    const workerPool = database.write as unknown as ConstructorParameters<typeof MysqlNotificationWorkerRepository>[0];
    const notificationPool = database.write as unknown as ConstructorParameters<typeof MysqlNotificationRepository>[0];
    const sender = createPushSender(process.env);
    const notifications = new NotificationService(
      new MysqlNotificationRepository(notificationPool),
      sender,
      process.env.VAPID_PUBLIC_KEY ?? '',
    );
    const repository = new MysqlNotificationWorkerRepository(workerPool);
    const push = new NotificationWorkerPush(notifications);
    let attempt = 0;

    log('info', 'worker_started', { version: config.APP_VERSION, intervalSeconds: config.WORKER_HEARTBEAT_SECONDS });
    await runWorkerLoop(async () => {
      attempt++;
      const result = await runNotificationWorker(repository, push, { attempt });
      log(result.status === 'failed' ? 'error' : 'info', 'worker_cycle', { attempt, ...result });
    }, {
      intervalMs: config.WORKER_HEARTBEAT_SECONDS * 1000,
      signal: abort.signal,
    });
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await database.close();
    log('info', 'worker_stopped');
  }
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  log('error', 'worker_fatal', { error: error instanceof Error ? error.message : String(error) });
});
