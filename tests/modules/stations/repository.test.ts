import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import {
  MysqlStationsRepository,
  type StationsConnection,
} from '../../../src/modules/stations/repository.js';
import {
  StationConflictError,
  StationHasPendingParcelsError,
  StationNotFoundError,
} from '../../../src/modules/stations/domain.js';

const header = (affectedRows: number, insertId = 0) => ({ affectedRows, insertId }) as ResultSetHeader;
const executeResult = (value: RowDataPacket[] | ResultSetHeader): [typeof value, unknown[]] => [value, []];

function connection(results: Array<[unknown, unknown]> = []): StationsConnection {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    execute: vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? executeResult(header(1)))),
  };
}
function pool(conn = connection()) {
  return { execute: vi.fn(), getConnection: vi.fn().mockResolvedValue(conn) };
}

const stationInput = { id: 0, name: '东门', normalizedName: '东门', address: '地址', courierNames: '顺丰,中通' };

describe('MysqlStationsRepository SQL contract', () => {
  it('lists legacy fields, parcel counts, user isolation, and exact legacy ordering', async () => {
    const db = pool();
    const rows = [{ id: 2, name: '东门', parcel_count: 4, pending_count: '2' }];
    db.execute.mockResolvedValue([rows, []]);
    await expect(new MysqlStationsRepository(db).list(7)).resolves.toBe(rows);
    expect(db.execute).toHaveBeenCalledWith(
      "SELECT s.id,s.name,s.address,s.courier_names,s.is_manual,s.use_count,s.last_used_at,s.created_at,COUNT(p.id) parcel_count,SUM(CASE WHEN p.status='pending' THEN 1 ELSE 0 END) pending_count FROM stations s LEFT JOIN parcels p ON p.station_id=s.id AND p.user_id=s.user_id WHERE s.user_id=? GROUP BY s.id,s.name,s.address,s.courier_names,s.is_manual,s.use_count,s.last_used_at,s.created_at ORDER BY s.is_manual DESC,COALESCE(s.last_used_at,s.created_at) DESC,s.id DESC",
      [7],
    );
  });

  it('inserts manual stations with legacy defaults', async () => {
    const db = pool();
    db.execute.mockResolvedValue(executeResult(header(1, 8)));
    await new MysqlStationsRepository(db).save(7, stationInput);
    expect(db.execute).toHaveBeenCalledWith(
      'INSERT INTO stations(user_id,name,normalized_name,address,courier_names,is_manual,use_count,last_used_at) VALUES(?,?,?,?,?,1,0,NULL)',
      [7, '东门', '东门', '地址', '顺丰,中通'],
    );
  });

  it('updates only the owning user and accepts unchanged values when the station still exists', async () => {
    const db = pool();
    db.execute.mockResolvedValueOnce(executeResult(header(0))).mockResolvedValueOnce([[{ id: 9 }], []]);
    await expect(new MysqlStationsRepository(db).save(7, { ...stationInput, id: 9 })).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenNthCalledWith(1,
      'UPDATE stations SET name=?,normalized_name=?,address=?,courier_names=?,is_manual=1 WHERE id=? AND user_id=?',
      ['东门', '东门', '地址', '顺丰,中通', 9, 7],
    );
    expect(db.execute).toHaveBeenNthCalledWith(2, 'SELECT id FROM stations WHERE id=? AND user_id=?', [9, 7]);
  });

  it('rejects updating a missing or another user station', async () => {
    const db = pool();
    db.execute.mockResolvedValueOnce(executeResult(header(0))).mockResolvedValueOnce([[], []]);
    await expect(new MysqlStationsRepository(db).save(7, { ...stationInput, id: 9 })).rejects.toBeInstanceOf(StationNotFoundError);
  });

  it('maps MySQL duplicate entry on insert or update to StationConflictError', async () => {
    const db = pool();
    db.execute.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }));
    await expect(new MysqlStationsRepository(db).save(7, stationInput)).rejects.toBeInstanceOf(StationConflictError);
  });

  it('protects delete with ownership and pending parcel count', async () => {
    const db = pool();
    db.execute.mockResolvedValueOnce([[{ id: 3, pending_count: 2 }], []]);
    await expect(new MysqlStationsRepository(db).delete(7, 3)).rejects.toBeInstanceOf(StationHasPendingParcelsError);
    expect(db.execute).toHaveBeenCalledWith(
      "SELECT s.id,(SELECT COUNT(*) FROM parcels p WHERE p.station_id=s.id AND p.user_id=s.user_id AND p.status='pending') pending_count FROM stations s WHERE s.id=? AND s.user_id=?",
      [3, 7],
    );
  });

  it('returns not found for delete outside the user and deletes an owned empty station', async () => {
    const missingDb = pool();
    missingDb.execute.mockResolvedValue([[], []]);
    await expect(new MysqlStationsRepository(missingDb).delete(7, 3)).rejects.toBeInstanceOf(StationNotFoundError);

    const db = pool();
    db.execute.mockResolvedValueOnce([[{ id: 3, pending_count: 0 }], []]).mockResolvedValueOnce(executeResult(header(1)));
    await new MysqlStationsRepository(db).delete(7, 3);
    expect(db.execute).toHaveBeenNthCalledWith(2, 'DELETE FROM stations WHERE id=? AND user_id=?', [3, 7]);
  });

  it('bulk-picks only pending parcels for the owning user in one transaction', async () => {
    const conn = connection([[ [{ name: '东门' }], [] ], executeResult(header(3))]);
    const db = pool(conn);
    await expect(new MysqlStationsRepository(db).markAllPicked(7, 3)).resolves.toEqual({ station: '东门', count: 3 });
    expect(vi.mocked(conn.beginTransaction)).toHaveBeenCalledOnce();
    expect(vi.mocked(conn.execute)).toHaveBeenNthCalledWith(1, 'SELECT name FROM stations WHERE id=? AND user_id=?', [3, 7]);
    expect(vi.mocked(conn.execute)).toHaveBeenNthCalledWith(2,
      "UPDATE parcels SET status='picked_up',picked_up_at=NOW() WHERE user_id=? AND station_id=? AND status='pending'",
      [7, 3],
    );
    expect(vi.mocked(conn.commit)).toHaveBeenCalledOnce();
    expect(vi.mocked(conn.release)).toHaveBeenCalledOnce();
  });

  it('rolls back missing stations and preserves the original error if rollback also fails', async () => {
    const conn = connection([[[], []]]);
    const rollbackError = new Error('rollback failed');
    vi.mocked(conn.rollback).mockRejectedValue(rollbackError);
    const promise = new MysqlStationsRepository(pool(conn)).markAllPicked(7, 99);
    await expect(promise).rejects.toBeInstanceOf(StationNotFoundError);
    await expect(promise).rejects.not.toBe(rollbackError);
    expect(vi.mocked(conn.commit)).not.toHaveBeenCalled();
    expect(vi.mocked(conn.release)).toHaveBeenCalledOnce();
  });

  it('releases the connection without rollback when beginning the transaction fails', async () => {
    const conn = connection();
    const beginError = new Error('begin failed');
    vi.mocked(conn.beginTransaction).mockRejectedValue(beginError);
    await expect(new MysqlStationsRepository(pool(conn)).markAllPicked(7, 3)).rejects.toBe(beginError);
    expect(vi.mocked(conn.rollback)).not.toHaveBeenCalled();
    expect(vi.mocked(conn.release)).toHaveBeenCalledOnce();
  });

  it('rolls back and releases when committing the transaction fails', async () => {
    const conn = connection([[ [{ name: '东门' }], [] ], executeResult(header(3))]);
    const commitError = new Error('commit failed');
    vi.mocked(conn.commit).mockRejectedValue(commitError);
    await expect(new MysqlStationsRepository(pool(conn)).markAllPicked(7, 3)).rejects.toBe(commitError);
    expect(vi.mocked(conn.rollback)).toHaveBeenCalledOnce();
    expect(vi.mocked(conn.release)).toHaveBeenCalledOnce();
  });

  it('preserves a commit error when the attempted rollback also fails', async () => {
    const conn = connection([[ [{ name: '东门' }], [] ], executeResult(header(3))]);
    const commitError = new Error('commit failed');
    vi.mocked(conn.commit).mockRejectedValue(commitError);
    vi.mocked(conn.rollback).mockRejectedValue(new Error('rollback failed'));
    await expect(new MysqlStationsRepository(pool(conn)).markAllPicked(7, 3)).rejects.toBe(commitError);
    expect(vi.mocked(conn.release)).toHaveBeenCalledOnce();
  });
});
