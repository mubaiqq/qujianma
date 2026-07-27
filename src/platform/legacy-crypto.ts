import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

function keyFromHex(keyHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('APP_KEY_HEX 必须是 64 位十六进制');
  return Buffer.from(keyHex, 'hex');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfForCookie(rawCookieToken: string): string {
  return createHmac('sha256', rawCookieToken).update('pickup-csrf').digest('hex');
}

export function encryptLegacySecret(value: string, keyHex: string, fixedIv?: Buffer): string {
  const iv = fixedIv ?? randomBytes(12);
  if (iv.length !== 12) throw new Error('AES-GCM IV 必须为 12 字节');
  const cipher = createCipheriv('aes-256-gcm', keyFromHex(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptLegacySecret(value: string, keyHex: string): string {
  try {
    const compact = value.replace(/[ \t\r\n]+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 === 1) return '';
    const paddingLength = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
    const unpadded = compact.slice(0, compact.length - paddingLength);
    if (unpadded.includes('=')) return '';
    const remainder = unpadded.length % 4;
    const expectedPadding = remainder === 2 ? 2 : remainder === 3 ? 1 : 0;
    if (paddingLength > 0 && paddingLength !== expectedPadding) return '';
    const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
    const raw = Buffer.from(padded, 'base64');
    if (raw.length < 29) return '';
    const decipher = createDecipheriv('aes-256-gcm', keyFromHex(keyHex), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
