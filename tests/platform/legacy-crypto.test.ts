import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { csrfForCookie, decryptLegacySecret, encryptLegacySecret, tokenHash } from '../../src/platform/legacy-crypto.js';

const keyHex = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const iv = Buffer.from('000102030405060708090a0b', 'hex');

describe('legacy authentication crypto compatibility', () => {
  it('hashes cookie and API tokens with SHA-256', () => {
    const token = '0123456789abcdef';
    expect(tokenHash(token)).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('derives CSRF exactly as PHP hash_hmac sha256', () => {
    const cookie = 'a'.repeat(64);
    expect(csrfForCookie(cookie)).toBe('6b056736869b96c981fc1a725afe19d74b2c4b9e5053643651ac2b8ebe196e11');
    expect(csrfForCookie(cookie)).toBe(createHmac('sha256', cookie).update('pickup-csrf').digest('hex'));
  });

  it('encrypts as base64(iv12 + tag16 + AES-256-GCM ciphertext)', () => {
    const encrypted = encryptLegacySecret('测试 secret', keyHex, iv);
    expect(encrypted).toBe('AAECAwQFBgcICQoLbJvE996FxfP2gDcZ2ZmszqG3XfNqcOJo6CLl7sU=');
    const raw = Buffer.from(encrypted, 'base64');
    expect(raw.subarray(0, 12)).toEqual(iv);
    expect(raw.subarray(12, 28)).toHaveLength(16);
    expect(decryptLegacySecret(encrypted, keyHex)).toBe('测试 secret');
    expect(decryptLegacySecret(` \n${encrypted}\t `, keyHex)).toBe('测试 secret');
    expect(decryptLegacySecret(encrypted.replace(/=+$/, ''), keyHex)).toBe('测试 secret');
  });

  it('returns an empty string for malformed or unauthentic legacy ciphertext', () => {
    expect(decryptLegacySecret('not-base64!', keyHex)).toBe('');
    expect(decryptLegacySecret('AAAAA', keyHex)).toBe('');
    expect(decryptLegacySecret('AA=A', keyHex)).toBe('');
    const paddedCiphertext = encryptLegacySecret('secret', keyHex, iv);
    expect(decryptLegacySecret(`${paddedCiphertext.slice(0, -2)}=`, keyHex)).toBe('');
    for (const whitespace of ['\u000b', '\u000c', '\u00a0', '\u2003']) {
      expect(decryptLegacySecret(`${whitespace}${paddedCiphertext}`, keyHex)).toBe('');
    }
    expect(decryptLegacySecret(encryptLegacySecret('secret', keyHex, iv), 'ff'.repeat(32))).toBe('');
    expect(decryptLegacySecret(encryptLegacySecret('secret', keyHex, iv), 'bad-key')).toBe('');
    const encrypted = encryptLegacySecret('secret', keyHex, iv);
    const raw = Buffer.from(encrypted, 'base64');
    raw[15] = (raw[15] ?? 0) ^ 0xff;
    expect(decryptLegacySecret(raw.toString('base64'), keyHex)).toBe('');
  });
});
