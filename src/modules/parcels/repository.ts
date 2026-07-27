import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  ParcelStateConflictError,
  parcelActionResult,
  type LegacyActionResponse,
  type DeleteRecordResponse,
  type RecordsQuery,
} from './domain.js';

export interface ParcelsSqlPool {
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>;
}

export type LegacyParcelItem = Record<string, unknown>;
export interface HomeData {
  items: LegacyParcelItem[];
  unparsed_count: 0;
}
export interface RecordsData extends HomeData {
  count: number;
  period: RecordsQuery['period'];
}

const homeSql = "SELECT p.id,p.pickup_code,p.courier_name,p.status,p.needs_review,p.received_at,TIMESTAMPDIFF(HOUR,p.received_at,NOW()) age_hours,p.picked_up_at,s.id station_id,COALESCE(s.name,'未命名驿站') station_name,COALESCE(s.address,'') station_address,m.id message_id,m.sender,m.raw_message,m.created_at server_received_at,m.ai_status,m.ai_error,m.ai_model FROM parcels p JOIN incoming_messages m ON m.id=p.message_id AND m.user_id=p.user_id LEFT JOIN stations s ON s.id=p.station_id AND s.user_id=p.user_id WHERE p.user_id=? AND p.status='pending' ORDER BY p.received_at DESC,p.id DESC";
const recordsSql = "SELECT COALESCE(p.id,0) id,COALESCE(p.pickup_code,'') pickup_code,COALESCE(p.courier_name,'') courier_name,COALESCE(p.status,'source_only') status,COALESCE(p.needs_review,0) needs_review,m.received_at,p.picked_up_at,s.id station_id,COALESCE(s.name,'') station_name,m.id message_id,m.sender,m.raw_message,m.created_at server_received_at,m.ai_status,m.ai_error,m.ai_model FROM incoming_messages m LEFT JOIN parcels p ON p.message_id=m.id AND p.user_id=m.user_id LEFT JOIN stations s ON s.id=p.station_id AND s.user_id=p.user_id WHERE m.user_id=?";

function formatShanghaiDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
}

function serializeRows(result: unknown): LegacyParcelItem[] {
  return (result as RowDataPacket[]).map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? formatShanghaiDateTime(value) : value]),
  ));
}

function assertRecordsQueryInvariant(query: RecordsQuery): void {
  if (query.period === 'all') {
    if (query.start !== undefined || query.end !== undefined) {
      throw new TypeError('RecordsQuery for all period must not include start or end');
    }
    return;
  }
  if (typeof query.start !== 'string' || query.start.length === 0
    || typeof query.end !== 'string' || query.end.length === 0) {
    throw new TypeError('RecordsQuery for a bounded period requires non-empty start and end');
  }
}

export class MysqlParcelsRepository {
  constructor(private readonly pool: ParcelsSqlPool) {}

  async getHome(userId: number): Promise<HomeData> {
    const [result] = await this.pool.execute(homeSql, [userId]);
    return { items: serializeRows(result), unparsed_count: 0 };
  }

  async getRecords(userId: number, query: RecordsQuery): Promise<RecordsData> {
    assertRecordsQueryInvariant(query);
    let sql = recordsSql;
    const values: unknown[] = [userId];
    if (query.status !== 'all') {
      sql += ' AND p.status=?';
      values.push(query.status);
    }
    if (query.period !== 'all') {
      sql += ' AND m.received_at>=? AND m.received_at<?';
      values.push(query.start, query.end);
    }
    sql += ' ORDER BY m.received_at DESC,m.id DESC,p.id DESC';
    const [result] = await this.pool.execute(sql, values);
    const items = serializeRows(result);
    return { items, count: items.length, period: query.period, unparsed_count: 0 };
  }

  async markPicked(id: number, userId: number): Promise<LegacyActionResponse> {
    return this.updateStatus(
      "UPDATE parcels SET status='picked_up',picked_up_at=NOW() WHERE id=? AND user_id=? AND status='pending'",
      id, userId, 'mark_picked',
    );
  }

  async undoPicked(id: number, userId: number): Promise<LegacyActionResponse> {
    return this.updateStatus(
      "UPDATE parcels SET status='pending',picked_up_at=NULL WHERE id=? AND user_id=? AND status='picked_up'",
      id, userId, 'undo_picked',
    );
  }

  async deleteRecord(id: number, messageId: number, userId: number): Promise<DeleteRecordResponse> {
    let deleted = 0;
    if (id > 0) {
      const [parcel] = await this.pool.execute(
        'DELETE FROM parcels WHERE id=? AND message_id=? AND user_id=?',
        [id, messageId, userId],
      );
      deleted += (parcel as ResultSetHeader).affectedRows;
    }
    const [message] = await this.pool.execute(
      'DELETE FROM incoming_messages WHERE id=? AND user_id=? AND NOT EXISTS (SELECT 1 FROM parcels WHERE message_id=? AND user_id=?)',
      [messageId, userId, messageId, userId],
    );
    deleted += (message as ResultSetHeader).affectedRows;
    if (deleted < 1) throw new ParcelStateConflictError();
    return { code: 0, message: '已删除' };
  }

  private async updateStatus(
    sql: string, id: number, userId: number, action: 'mark_picked' | 'undo_picked',
  ): Promise<LegacyActionResponse> {
    const [result] = await this.pool.execute(sql, [id, userId]);
    if ((result as ResultSetHeader).affectedRows !== 1) throw new ParcelStateConflictError();
    return parcelActionResult(action);
  }
}
