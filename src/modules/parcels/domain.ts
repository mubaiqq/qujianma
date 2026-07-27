export type RecordsPeriod = 'today' | 'yesterday' | 'this_month' | 'last_month' | 'all';
export type BoundedRecordsPeriod = Exclude<RecordsPeriod, 'all'>;
export type ParcelStatusFilter = 'pending' | 'picked_up' | 'all';
export type ParcelAction = 'mark_picked' | 'undo_picked';

interface RecordsQueryBase {
  status: ParcelStatusFilter;
}

export type RecordsQuery = RecordsQueryBase & (
  | { period: 'all'; start?: never; end?: never }
  | { period: BoundedRecordsPeriod; start: string; end: string }
);

export interface LegacyActionResponse {
  code: 0;
  message: '已取件' | '已恢复待取';
}

export interface DeleteRecordResponse { code: 0; message: '已删除' }

const shanghaiDateTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function formatShanghai(date: Date): string {
  return shanghaiDateTime.format(date).replace(', ', ' ');
}

function shanghaiCalendar(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

// Shanghai has no DST. UTC Date construction avoids dependence on the process time zone.
function shanghaiMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, -8));
}

function normalizePeriod(value: unknown): RecordsPeriod {
  return value === 'today' || value === 'yesterday' || value === 'this_month'
    || value === 'last_month' || value === 'all' ? value : 'this_month';
}

function normalizeStatus(value: unknown): ParcelStatusFilter {
  return value === 'pending' || value === 'picked_up' ? value : 'all';
}

export function getRecordsQuery(periodValue: unknown, statusValue: unknown, now = new Date()): RecordsQuery {
  const period = normalizePeriod(periodValue);
  const status = normalizeStatus(statusValue);
  if (period === 'all') return { period, status };

  const { year, month, day } = shanghaiCalendar(now);
  let start: Date;
  let end: Date;
  if (period === 'today' || period === 'yesterday') {
    end = shanghaiMidnight(year, month, day + (period === 'today' ? 1 : 0));
    start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === 'this_month') {
    start = shanghaiMidnight(year, month, 1);
    end = shanghaiMidnight(year, month + 1, 1);
  } else {
    start = shanghaiMidnight(year, month - 1, 1);
    end = shanghaiMidnight(year, month, 1);
  }
  return { period, status, start: formatShanghai(start), end: formatShanghai(end) };
}

export class ParcelStateConflictError extends Error {
  readonly statusCode = 404;
  readonly code = 1;

  constructor() {
    super('记录不存在或状态已变化');
    this.name = 'ParcelStateConflictError';
  }
}

export function parcelActionResult(action: ParcelAction): LegacyActionResponse {
  return { code: 0, message: action === 'mark_picked' ? '已取件' : '已恢复待取' };
}
