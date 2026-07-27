import { describe, expect, it } from 'vitest';
import { assertReadOnlyGrants } from '../../src/platform/database.js';

describe('read-only MySQL grant validation', () => {
  it('accepts a full-access account when the same account is used for writes', () => {
    expect(() => assertReadOnlyGrants([
      "GRANT USAGE ON *.* TO 'qjm'@'127.0.0.1'",
      "GRANT ALL PRIVILEGES ON `qjm`.* TO 'qjm'@'127.0.0.1'",
    ], 'qjm', true)).not.toThrow();
  });

  it('accepts only USAGE globally and SELECT on the configured database', () => {
    expect(() => assertReadOnlyGrants([
      "GRANT USAGE ON *.* TO `reader`@`localhost`",
      "GRANT SELECT ON `express_pickup`.* TO `reader`@`localhost`",
    ], 'express_pickup')).not.toThrow();
  });

  it('decodes escaped database identifiers before matching the target', () => {
    expect(() => assertReadOnlyGrants([
      "GRANT USAGE ON *.* TO `reader`@`localhost`",
      "GRANT SELECT ON `express``pickup`.* TO `reader`@`localhost`",
    ], 'express`pickup')).not.toThrow();
  });

  it.each([
    ["GRANT UPDATE ON `express_pickup`.* TO `reader`@`localhost`", 'write privilege'],
    ["GRANT SELECT ON *.* TO `reader`@`localhost`", 'global SELECT'],
    ["GRANT SELECT ON `other_database`.* TO `reader`@`localhost`", 'wrong database'],
    ["GRANT SELECT ON `express_pickup`.`users` TO `reader`@`localhost`", 'table grant'],
    ["GRANT SELECT (`email`) ON `express_pickup`.`users` TO `reader`@`localhost`", 'column grant'],
    ["GRANT `reporting_role`@`%` TO `reader`@`localhost`", 'role grant'],
    ["GRANT USAGE ON *.* TO `reader`@`localhost` WITH GRANT OPTION", 'unknown suffix'],
    ['unparseable grant text', 'unknown syntax'],
  ])('rejects %s (%s)', (grant) => {
    expect(() => assertReadOnlyGrants([grant], 'express_pickup')).toThrow(/不安全或无法识别的数据库授权/);
  });

  it('rejects missing or non-string SHOW GRANTS values', () => {
    expect(() => assertReadOnlyGrants([], 'express_pickup')).toThrow(/不安全或无法识别的数据库授权/);
    expect(() => assertReadOnlyGrants([42], 'express_pickup')).toThrow(/不安全或无法识别的数据库授权/);
  });
});
