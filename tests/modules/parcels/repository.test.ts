import type { ResultSetHeader } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import {
  getRecordsQuery,
  ParcelStateConflictError,
  type RecordsQuery,
} from '../../../src/modules/parcels/domain.js';
import { MysqlParcelsRepository } from '../../../src/modules/parcels/repository.js';

function poolMock() {
  return { execute: vi.fn() };
}
function result(affectedRows: number): ResultSetHeader {
  return { affectedRows } as ResultSetHeader;
}

const recordsSelect = "SELECT COALESCE(p.id,0) id,COALESCE(p.pickup_code,'') pickup_code,COALESCE(p.courier_name,'') courier_name,COALESCE(p.status,'source_only') status,COALESCE(p.needs_review,0) needs_review,m.received_at,p.picked_up_at,s.id station_id,COALESCE(s.name,'') station_name,m.id message_id,m.sender,m.raw_message,m.created_at server_received_at,m.ai_status,m.ai_error,m.ai_model FROM incoming_messages m LEFT JOIN parcels p ON p.message_id=m.id AND p.user_id=m.user_id LEFT JOIN stations s ON s.id=p.station_id AND s.user_id=p.user_id WHERE m.user_id=?";

describe('MysqlParcelsRepository legacy SQL contract', () => {
  it('gets pending home parcels isolated by user with exact legacy fields and ordering', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[], []]);
    await expect(new MysqlParcelsRepository(pool).getHome(42)).resolves.toEqual({ items: [], unparsed_count: 0 });
    expect(pool.execute).toHaveBeenCalledWith(
      "SELECT p.id,p.pickup_code,p.courier_name,p.status,p.needs_review,p.received_at,TIMESTAMPDIFF(HOUR,p.received_at,NOW()) age_hours,p.picked_up_at,s.id station_id,COALESCE(s.name,'未命名驿站') station_name,COALESCE(s.address,'') station_address,m.id message_id,m.sender,m.raw_message,m.created_at server_received_at,m.ai_status,m.ai_error,m.ai_model FROM parcels p JOIN incoming_messages m ON m.id=p.message_id AND m.user_id=p.user_id LEFT JOIN stations s ON s.id=p.station_id AND s.user_id=p.user_id WHERE p.user_id=? AND p.status='pending' ORDER BY p.received_at DESC,p.id DESC",
      [42],
    );
  });

  it('gets filtered records with status before a half-open period and reports legacy metadata', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[{ id: 1 }], []]);
    const query = getRecordsQuery('today', 'pending', new Date('2026-07-25T16:30:00Z'));
    await expect(new MysqlParcelsRepository(pool).getRecords(42, query)).resolves.toEqual({
      items: [{ id: 1 }], count: 1, period: 'today', unparsed_count: 0,
    });
    expect(pool.execute).toHaveBeenCalledWith(
      `${recordsSelect} AND p.status=? AND m.received_at>=? AND m.received_at<? ORDER BY m.received_at DESC,m.id DESC,p.id DESC`,
      [42, 'pending', '2026-07-26 00:00:00', '2026-07-27 00:00:00'],
    );
  });

  it('gets all periods and statuses without optional predicates', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[], []]);
    await new MysqlParcelsRepository(pool).getRecords(7, getRecordsQuery('all', 'invalid'));
    expect(pool.execute).toHaveBeenCalledWith(
      `${recordsSelect} ORDER BY m.received_at DESC,m.id DESC,p.id DESC`, [7],
    );
  });

  it.each([
    { period: 'today', status: 'all' },
    { period: 'yesterday', status: 'pending', start: '2026-07-25 00:00:00' },
    { period: 'this_month', status: 'picked_up', end: '2026-08-01 00:00:00' },
    { period: 'last_month', status: 'all', start: '', end: '2026-07-01 00:00:00' },
  ])('rejects malformed bounded query before executing SQL: $period', async (malformed) => {
    const pool = poolMock();
    const repository = new MysqlParcelsRepository(pool);

    await expect(repository.getRecords(7, malformed as RecordsQuery)).rejects.toThrow(
      'RecordsQuery for a bounded period requires non-empty start and end',
    );
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed all-period query carrying bounds before executing SQL', async () => {
    const pool = poolMock();
    const malformed = {
      period: 'all', status: 'all', start: '2026-07-01 00:00:00', end: '2026-08-01 00:00:00',
    } as unknown as RecordsQuery;

    await expect(new MysqlParcelsRepository(pool).getRecords(7, malformed)).rejects.toThrow(
      'RecordsQuery for all period must not include start or end',
    );
    expect(pool.execute).not.toHaveBeenCalled();
  });

  it('preserves mysql2 strings and converts Date fields to Shanghai PHP DATETIME strings', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([[
      {
        id: 1, received_at: new Date('2026-07-25T16:30:45Z'), picked_up_at: null,
        server_received_at: new Date('2026-07-25T17:00:00Z'), untouched: '2026-07-26 02:00:00',
      },
    ], []]);
    const data = await new MysqlParcelsRepository(pool).getHome(42);
    expect(data.items[0]).toEqual({
      id: 1, received_at: '2026-07-26 00:30:45', picked_up_at: null,
      server_received_at: '2026-07-26 01:00:00', untouched: '2026-07-26 02:00:00',
    });
  });

  it('marks only the user pending parcel picked up using database NOW', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([result(1), []]);
    await expect(new MysqlParcelsRepository(pool).markPicked(9, 42)).resolves.toEqual({ code: 0, message: '已取件' });
    expect(pool.execute).toHaveBeenCalledWith(
      "UPDATE parcels SET status='picked_up',picked_up_at=NOW() WHERE id=? AND user_id=? AND status='pending'", [9, 42],
    );
  });

  it('undoes only the user picked parcel', async () => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([result(1), []]);
    await expect(new MysqlParcelsRepository(pool).undoPicked(9, 42)).resolves.toEqual({ code: 0, message: '已恢复待取' });
    expect(pool.execute).toHaveBeenCalledWith(
      "UPDATE parcels SET status='pending',picked_up_at=NULL WHERE id=? AND user_id=? AND status='picked_up'", [9, 42],
    );
  });

  it.each(['markPicked', 'undoPicked'] as const)('maps affectedRows other than one to the legacy 404 for %s', async (method) => {
    const pool = poolMock();
    pool.execute.mockResolvedValue([result(0), []]);
    await expect(new MysqlParcelsRepository(pool)[method](9, 42)).rejects.toBeInstanceOf(ParcelStateConflictError);
  });
});
