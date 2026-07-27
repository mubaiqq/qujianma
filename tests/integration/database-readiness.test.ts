import { afterAll, describe, expect, it } from 'vitest';
import { createConnection } from 'mysql2/promise';
import { loadConfig } from '../../src/platform/config.js';
import { createDatabase, requiredLegacyTables } from '../../src/platform/database.js';

const runIntegration = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;
const poolLimit = 5;

function expectPrivilegeDenied(error: unknown, operation: 'UPDATE' | 'DELETE'): void {
  expect(error).toMatchObject({ errno: 1142, sqlState: '42000' });
  expect(String((error as { message?: unknown }).message)).toContain(`${operation} command denied`);
}

runIntegration('production schema readiness (read-only)', () => {
  const config = loadConfig(process.env);
  const database = createDatabase(config);

  afterAll(async () => database.close());

  it('connects with utf8mb4 and +08:00 session time zone', async () => {
    const status = await database.readiness();
    expect(status.connected).toBe(true);
    expect(status.timeZone).toBe('+08:00');
    expect(status.characterSet).toBe('utf8mb4');
  });

  it('contains every legacy table required by the migration contract', async () => {
    const status = await database.readiness();
    expect(status.missingTables).toEqual([]);
    expect(status.tables).toEqual(expect.arrayContaining([...requiredLegacyTables]));
  });

  it('uses an account without write privileges during the read-only migration phase', async () => {
    const status = await database.readiness();
    expect(status.writePrivileges).toEqual([]);
  });

  it.each([
    ['UPDATE', 'UPDATE users SET id = id WHERE 1 = 0'],
    ['DELETE', 'DELETE FROM users WHERE 1 = 0'],
  ] as const)('denies a zero-impact %s statement at the server', async (operation, sql) => {
    const connection = await createConnection({
      host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
      user: config.DB_USER, password: config.DB_PASSWORD,
    });
    try {
      await expect(connection.query(sql)).rejects.toSatisfy((error: unknown) => {
        expectPrivilegeDenied(error, operation);
        return true;
      });
    } finally {
      await connection.end();
    }
  });

  it('releases connections across more consecutive probes than the pool limit', async () => {
    for (let index = 0; index < poolLimit * 3; index += 1) {
      await expect(database.readiness()).resolves.toMatchObject({ connected: true });
    }
  });

  it('releases connections after fail-closed grant-validation errors', async () => {
    const invalidDatabase = createDatabase({ ...config, DB_NAME: 'information_schema' });
    try {
      for (let index = 0; index < poolLimit * 2; index += 1) {
        await expect(invalidDatabase.readiness()).rejects.toThrow();
      }
    } finally {
      await invalidDatabase.close();
    }
    await expect(database.readiness()).resolves.toMatchObject({ connected: true });
  });
});
