import { createRequire } from 'node:module';
import type { PushSender, StoredSubscription } from '../modules/notifications/service.js';

export interface WebPushClient {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { contentEncoding?: string },
  ): Promise<unknown>;
}

export interface VapidEnvironment {
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

interface PushError extends Error { statusCode?: number; body?: string }

function reason(error: unknown): string {
  if (!(error instanceof Error)) return 'Web Push provider failed';
  const pushError = error as PushError;
  return pushError.message || pushError.body || 'Web Push provider failed';
}

export class WebPushSender implements PushSender {
  constructor(private readonly client: WebPushClient) {}

  async send(subscription: StoredSubscription, payload: Record<string, unknown>) {
    try {
      await this.client.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload), { contentEncoding: subscription.contentEncoding });
      return { success: true };
    } catch (error) {
      const statusCode = (error as PushError | undefined)?.statusCode;
      return { success: false, expired: statusCode === 404 || statusCode === 410, reason: reason(error) };
    }
  }
}

function loadWebPush(): WebPushClient {
  const require = createRequire(import.meta.url);
  try {
    return require('web-push') as WebPushClient;
  } catch (error) {
    throw new Error('Web Push dependency "web-push" is unavailable', { cause: error });
  }
}

/** Factory shared by the HTTP notification service and the background worker. */
export function createPushSender(environment: VapidEnvironment, client: WebPushClient = loadWebPush()): PushSender {
  const subject = environment.VAPID_SUBJECT?.trim();
  const publicKey = environment.VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.VAPID_PRIVATE_KEY?.trim();
  if (!subject || !publicKey || !privateKey) throw new Error('VAPID configuration is incomplete');
  client.setVapidDetails(subject, publicKey, privateKey);
  return new WebPushSender(client);
}
