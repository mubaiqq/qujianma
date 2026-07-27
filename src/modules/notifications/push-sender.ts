import { createRequire } from 'node:module';
import type * as WebPush from 'web-push';
import type { PushSender, StoredSubscription } from './service.js';

const webpush = createRequire(import.meta.url)('web-push') as typeof WebPush;

export interface PushSenderConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export function createPushSender(config: PushSenderConfig): PushSender {
  if (!config.publicKey || !config.privateKey) {
    return { send() { return Promise.resolve({ success: false, reason: 'Web Push VAPID 尚未配置' }); } };
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return {
    async send(subscription: StoredSubscription, payload: Record<string, unknown>) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { contentEncoding: subscription.contentEncoding as 'aes128gcm' | 'aesgcm' });
        return { success: true };
      } catch (error) {
        const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
        return { success: false, expired: statusCode === 404 || statusCode === 410, reason: error instanceof Error ? error.message : 'Web Push 发送失败' };
      }
    },
  };
}
