import { randomBytes } from 'node:crypto';
import { encryptLegacySecret, tokenHash } from '../../platform/legacy-crypto.js';
import { hashPassword, verifyPassword } from '../../platform/password.js';

export interface AccountCrypto {
  verifyPassword(password: string, hash: string): Promise<boolean>;
  hashPassword(password: string): Promise<string>;
  hashToken(token: string): string;
  encryptSecret(token: string): string;
  randomHex(bytes: number): string;
}

export function createAccountCrypto(keyHex: string): AccountCrypto {
  return {
    verifyPassword,
    hashPassword,
    hashToken: tokenHash,
    encryptSecret: (token) => encryptLegacySecret(token, keyHex),
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
  };
}
