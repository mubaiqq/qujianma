import { describe, expect, it, vi } from 'vitest';
import { createPushSender, WebPushSender, type WebPushClient } from '../../src/platform/push-sender.js';

const subscription = { id: 1, endpoint: 'https://push.example/sub', p256dh: 'public-key', auth: 'auth-secret', contentEncoding: 'aes128gcm' };

describe('WebPushSender', () => {
  it('configures VAPID and sends the real subscription payload', async () => {
    const setVapidDetails = vi.fn();
    const sendNotification = vi.fn().mockResolvedValue({ statusCode: 201 });
    const client: WebPushClient = { setVapidDetails, sendNotification };
    const sender = createPushSender({
      VAPID_SUBJECT: 'mailto:ops@example.com',
      VAPID_PUBLIC_KEY: 'public',
      VAPID_PRIVATE_KEY: 'private',
    }, client);

    await expect(sender.send(subscription, { title: '通知', body: '正文' })).resolves.toEqual({ success: true });
    expect(setVapidDetails).toHaveBeenCalledWith('mailto:ops@example.com', 'public', 'private');
    expect(sendNotification).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify({ title: '通知', body: '正文' }), { contentEncoding: 'aes128gcm' });
  });

  it('fails explicitly when VAPID is incomplete', () => {
    expect(() => createPushSender({ VAPID_PUBLIC_KEY: 'public' }, { setVapidDetails: vi.fn(), sendNotification: vi.fn() }))
      .toThrow('VAPID configuration is incomplete');
  });

  it('reports expired subscriptions and does not turn provider failures into success', async () => {
    const expired = new WebPushSender({
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 })),
    });
    await expect(expired.send(subscription, {})).resolves.toEqual({ success: false, expired: true, reason: 'gone' });

    const failed = new WebPushSender({
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn().mockRejectedValue(Object.assign(new Error('provider unavailable'), { statusCode: 503 })),
    });
    await expect(failed.send(subscription, {})).resolves.toEqual({ success: false, expired: false, reason: 'provider unavailable' });
  });
});
