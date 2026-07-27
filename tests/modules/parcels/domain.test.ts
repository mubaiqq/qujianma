import { describe, expect, it } from 'vitest';
import {
  ParcelStateConflictError,
  getRecordsQuery,
  parcelActionResult,
  type RecordsQuery,
} from '../../../src/modules/parcels/domain.js';

const now = new Date('2026-07-25T16:30:45.000Z'); // 2026-07-26 00:30:45 Asia/Shanghai

describe('parcels legacy domain contract', () => {
  it('models all and bounded records queries as a discriminated union', () => {
    const allQuery: RecordsQuery = { period: 'all', status: 'all' };
    const boundedQuery: RecordsQuery = {
      period: 'today', status: 'pending', start: '2026-07-26 00:00:00', end: '2026-07-27 00:00:00',
    };
    // @ts-expect-error bounded periods require both bounds
    const missingBounds: RecordsQuery = { period: 'today', status: 'all' };
    // @ts-expect-error all must remain unbounded
    const boundedAll: RecordsQuery = { period: 'all', status: 'all', start: '2026-07-26 00:00:00' };

    expect([allQuery.period, boundedQuery.period, missingBounds.period, boundedAll.period]).toEqual([
      'all', 'today', 'today', 'all',
    ]);
  });

  it.each([
    ['today', '2026-07-26 00:00:00', '2026-07-27 00:00:00'],
    ['yesterday', '2026-07-25 00:00:00', '2026-07-26 00:00:00'],
    ['this_month', '2026-07-01 00:00:00', '2026-08-01 00:00:00'],
    ['last_month', '2026-06-01 00:00:00', '2026-07-01 00:00:00'],
  ] as const)('builds the %s half-open range in Asia/Shanghai', (period, start, end) => {
    expect(getRecordsQuery(period, 'all', now)).toEqual({ period, status: 'all', start, end });
  });

  it('keeps all unbounded and falls back from an invalid period to this_month', () => {
    expect(getRecordsQuery('all', 'pending', now)).toEqual({ period: 'all', status: 'pending' });
    expect(getRecordsQuery('future', 'picked_up', now)).toEqual({
      period: 'this_month', status: 'picked_up', start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00',
    });
  });

  it('treats every unsupported status as all like PHP', () => {
    expect(getRecordsQuery('today', 'deleted', now).status).toBe('all');
    expect(getRecordsQuery(undefined, undefined, now)).toEqual({
      period: 'this_month', status: 'all', start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00',
    });
  });

  it('maps successful actions and stale updates to the exact legacy messages', () => {
    expect(parcelActionResult('mark_picked')).toEqual({ code: 0, message: '已取件' });
    expect(parcelActionResult('undo_picked')).toEqual({ code: 0, message: '已恢复待取' });
    const error = new ParcelStateConflictError();
    expect(error).toMatchObject({ statusCode: 404, code: 1, message: '记录不存在或状态已变化' });
  });
});
