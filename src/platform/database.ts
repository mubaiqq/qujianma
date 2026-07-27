import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import type { AppConfig } from './config.js';

export const requiredLegacyTables = [
  'users', 'login_tokens', 'api_tokens', 'app_devices', 'ai_providers', 'incoming_messages',
  'stations', 'parcels', 'notification_preferences', 'push_subscriptions', 'share_links', 'share_link_parcels',
] as const;

const mysqlQuotedIdentifier = '`(?:``|[^`])+`';
const mysqlAccount = `(?:${mysqlQuotedIdentifier}|'(?:''|[^'])+')@(?:${mysqlQuotedIdentifier}|'(?:''|[^'])+')`;
const allowedGrantPattern = new RegExp(
  `^GRANT\\s+(USAGE|SELECT|ALL PRIVILEGES)\\s+ON\\s+(\\*\\.\\*|(${mysqlQuotedIdentifier})\\.\\*)\\s+TO\\s+${mysqlAccount}$`,
  'i',
);

interface SessionRow extends RowDataPacket {
  time_zone: string;
  character_set_connection: string;
}

interface TableRow extends RowDataPacket {
  TABLE_NAME?: string;
  table_name?: string;
}

type GrantRow = RowDataPacket;

export function tableNameFromRow(row: Pick<TableRow, 'TABLE_NAME' | 'table_name'>): string {
  return row.TABLE_NAME ?? row.table_name ?? '';
}

export interface DatabaseReadiness {
  connected: true;
  timeZone: string;
  characterSet: string;
  tables: string[];
  missingTables: string[];
  writePrivileges: string[];
}

function unquoteIdentifier(identifier: string): string {
  return identifier.slice(1, -1).replaceAll('``', '`');
}

export function assertReadOnlyGrants(grants: readonly unknown[], databaseName: string, allowWrite = false): void {
  if (grants.length === 0) throw new Error('不安全或无法识别的数据库授权');

  for (const grant of grants) {
    if (typeof grant !== 'string') throw new Error('不安全或无法识别的数据库授权');
    const match = allowedGrantPattern.exec(grant);
    const privilege = match?.[1]?.toUpperCase();
    const scope = match?.[2];
    const quotedDatabase = match?.[3];
    const allowed = privilege === 'USAGE'
      ? scope === '*.*'
      : (privilege === 'SELECT' || (allowWrite && privilege === 'ALL PRIVILEGES'))
        && quotedDatabase !== undefined && unquoteIdentifier(quotedDatabase) === databaseName;
    if (!allowed) throw new Error('不安全或无法识别的数据库授权');
  }
}

export interface DatabasePools {
  read: Pool;
  write: Pool;
  readiness: () => Promise<DatabaseReadiness>;
  close: () => Promise<void>;
}

function poolConfig(config: AppConfig, user: string, password: string) {
  return {
    host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME, user, password,
    charset: 'utf8mb4', timezone: '+08:00', connectionLimit: 5, enableKeepAlive: true,
  };
}

export function createDatabase(config: AppConfig): DatabasePools {
  const read = createPool(poolConfig(config, config.DB_USER, config.DB_PASSWORD));
  const write = config.DB_WRITE_USER
    ? createPool(poolConfig(config, config.DB_WRITE_USER, config.DB_WRITE_PASSWORD ?? ''))
    : read;

  return {
    read,
    write,
    async readiness(): Promise<DatabaseReadiness> {
      const connection = await read.getConnection();
      try {
        await connection.query("SET time_zone = '+08:00'");
        const [sessionRows] = await connection.query<SessionRow[]>(
          'SELECT @@session.time_zone AS time_zone, @@character_set_connection AS character_set_connection',
        );
        const [tableRows] = await connection.query<TableRow[]>(
          'SELECT table_name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
          [config.DB_NAME],
        );
        const [grantRows] = await connection.query<GrantRow[]>('SHOW GRANTS');
        const session = sessionRows[0];
        if (!session) throw new Error('数据库未返回会话状态');
        const tables = tableRows.map(tableNameFromRow).filter(Boolean);
        const grants: unknown[] = grantRows.flatMap((row) => Object.values(row as unknown as Record<string, unknown>));
        assertReadOnlyGrants(grants, config.DB_NAME, write === read || config.DB_USER === config.DB_WRITE_USER);
        return {
          connected: true,
          timeZone: session.time_zone,
          characterSet: session.character_set_connection,
          tables,
          missingTables: requiredLegacyTables.filter((table) => !tables.includes(table)),
          writePrivileges: [],
        };
      } finally {
        connection.release();
      }
    },
    async close(): Promise<void> {
      await Promise.all(write === read ? [read.end()] : [read.end(), write.end()]);
    },
  };
}
