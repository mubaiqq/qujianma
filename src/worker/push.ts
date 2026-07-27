import type { NotificationService } from '../modules/notifications/service.js';
import type { WorkerPush } from './notifications.js';

export class NotificationWorkerPush implements WorkerPush {
  constructor(private readonly notifications: NotificationService) {}

  sendDaily(userId: number, total: number) {
    return this.notifications.send(userId, {
      title: '取件提醒',
      body: `您有 ${total} 个待取包裹`,
      tag: `daily-${userId}`,
      url: '/',
    });
  }

  sendOverdue(userId: number, hours: 24 | 48 | 72) {
    return this.notifications.send(userId, {
      title: '包裹滞留提醒',
      body: `您有包裹已待取超过 ${hours} 小时，请及时领取`,
      tag: `overdue-${hours}-${userId}`,
      url: '/',
    });
  }
}
