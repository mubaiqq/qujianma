import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/platform/password.js';

const fictionalPassword = 'Fictional-Pickup-Only-2026!';
const phpBcryptVector = '$2y$10$N9u1Bni/xliYySmRs0U2duD79WS34lsqNn670iwYXopepVpjwQhlS';

describe('PHP bcrypt password compatibility', () => {
  it('verifies a fixed PHP password_hash $2y$ vector', async () => {
    await expect(verifyPassword(fictionalPassword, phpBcryptVector)).resolves.toBe(true);
  });

  it('also verifies the equivalent Node $2b$ representation', async () => {
    const nodeBcryptVector = `$2b$${phpBcryptVector.slice(4)}`;
    await expect(verifyPassword(fictionalPassword, nodeBcryptVector)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    await expect(verifyPassword('Entirely-Wrong-Password', phpBcryptVector)).resolves.toBe(false);
  });

  it('returns false for malformed or unsafe-cost hashes without invoking expensive work', async () => {
    for (const hash of [
      'not-a-bcrypt-hash', '$2y$broken',
      phpBcryptVector.replace('$2y$10$', '$2a$10$'),
      phpBcryptVector.replace('$2y$10$', '$2y$03$'),
      phpBcryptVector.replace('$2y$10$', '$2y$31$'),
      `${phpBcryptVector}extra`,
    ]) {
      await expect(verifyPassword(fictionalPassword, hash)).resolves.toBe(false);
    }
  });

  it('creates a $2y$ bcrypt hash accepted by PHP password_verify', async () => {
    const hash = await hashPassword(fictionalPassword);

    expect(hash).toMatch(/^\$2y\$12\$/);
    const phpVerified = execFileSync(
      'php',
      ['-r', 'exit(password_verify($argv[1], $argv[2]) ? 0 : 1);', fictionalPassword, hash],
      { stdio: 'ignore' },
    );
    expect(phpVerified).toBeDefined();
  });
});
