import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  StationConflictError,
  StationHasPendingParcelsError,
  StationNotFoundError,
  type SaveStationRecord,
  type StationRecord,
  type StationsRepository,
} from './domain.js';

export interface StationsSqlExecutor {
  execute(this: void, sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

export interface StationsConnection extends StationsSqlExecutor {
  beginTransaction(this: void): Promise<void>;
  commit(this: void): Promise<void>;
  rollback(this: void): Promise<void>;
  release(this: void): void;
}

export interface StationsPool extends StationsSqlExecutor {
  getConnection(): Promise<StationsConnection>;
}

interface IdRow extends RowDataPacket { id: number }
interface DeleteCheckRow extends IdRow { pending_count: number | string }
interface NameRow extends RowDataPacket { name: string }

const listSql = "SELECT s.id,s.name,s.address,s.courier_names,s.is_manual,s.use_count,s.last_used_at,s.created_at,COUNT(p.id) parcel_count,SUM(CASE WHEN p.status='pending' THEN 1 ELSE 0 END) pending_count FROM stations s LEFT JOIN parcels p ON p.station_id=s.id AND p.user_id=s.user_id WHERE s.user_id=? GROUP BY s.id,s.name,s.address,s.courier_names,s.is_manual,s.use_count,s.last_used_at,s.created_at ORDER BY s.is_manual DESC,COALESCE(s.last_used_at,s.created_at) DESC,s.id DESC";

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}

export class MysqlStationsRepository implements StationsRepository {
  constructor(private readonly pool: StationsPool) {}

  async list(userId: number): Promise<StationRecord[]> {
    const [rows] = await this.pool.execute(listSql, [userId]);
    return rows as StationRecord[];
  }

  async save(userId: number, station: SaveStationRecord): Promise<void> {
    try {
      if (station.id !== 0) {
        const [result] = await this.pool.execute(
          'UPDATE stations SET name=?,normalized_name=?,address=?,courier_names=?,is_manual=1 WHERE id=? AND user_id=?',
          [station.name, station.normalizedName, station.address, station.courierNames, station.id, userId],
        );
        if ((result as ResultSetHeader).affectedRows === 0) {
          const [rows] = await this.pool.execute('SELECT id FROM stations WHERE id=? AND user_id=?', [station.id, userId]);
          if ((rows as IdRow[])[0] === undefined) throw new StationNotFoundError();
        }
        return;
      }
      await this.pool.execute(
        'INSERT INTO stations(user_id,name,normalized_name,address,courier_names,is_manual,use_count,last_used_at) VALUES(?,?,?,?,?,1,0,NULL)',
        [userId, station.name, station.normalizedName, station.address, station.courierNames],
      );
    } catch (error) {
      if (isDuplicateEntry(error)) throw new StationConflictError();
      throw error;
    }
  }

  async delete(userId: number, stationId: number): Promise<void> {
    const [rows] = await this.pool.execute(
      "SELECT s.id,(SELECT COUNT(*) FROM parcels p WHERE p.station_id=s.id AND p.user_id=s.user_id AND p.status='pending') pending_count FROM stations s WHERE s.id=? AND s.user_id=?",
      [stationId, userId],
    );
    const station = (rows as DeleteCheckRow[])[0];
    if (station === undefined) throw new StationNotFoundError();
    if (Number(station.pending_count) > 0) throw new StationHasPendingParcelsError();
    await this.pool.execute('DELETE FROM stations WHERE id=? AND user_id=?', [stationId, userId]);
  }

  async markAllPicked(userId: number, stationId: number): Promise<{ station: string; count: number }> {
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [rows] = await connection.execute('SELECT name FROM stations WHERE id=? AND user_id=?', [stationId, userId]);
      const station = (rows as NameRow[])[0];
      if (station === undefined) throw new StationNotFoundError();
      const [result] = await connection.execute(
        "UPDATE parcels SET status='picked_up',picked_up_at=NOW() WHERE user_id=? AND station_id=? AND status='pending'",
        [userId, stationId],
      );
      const count = (result as ResultSetHeader).affectedRows;
      await connection.commit();
      return { station: station.name, count };
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the operation's original error, matching PHP's externally visible failure.
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
