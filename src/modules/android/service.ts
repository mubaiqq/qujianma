import type { PublicDevice } from './domain.js';

export interface DeviceRegistrationInput { deviceId?: string; platform?: string; name?: string; appVersion?: string }
export interface DeviceTokenCrypto { randomToken(): string; hashToken(token: string): string; encryptToken(token: string): string; decryptToken(ciphertext: string): string }
export interface StoredDevice { id: number; userId: number; deviceId: string; platform: string; name: string; appVersion: string; tokenCiphertext: string; tokenPrefix: string; revokedAt: string | null }
export interface NewDevice extends Omit<StoredDevice, 'id' | 'tokenCiphertext' | 'tokenPrefix' | 'revokedAt'> { tokenHash: string; tokenCiphertext: string; tokenPrefix: string }
export interface AndroidDeviceRepository {
  listActive(userId: number): Promise<PublicDevice[]>;
  findForUpdate(userId: number, deviceId: string): Promise<StoredDevice | null>;
  create(record: NewDevice): Promise<number>;
  restore(id: number, userId: number, record: Omit<NewDevice, 'userId' | 'deviceId'>): Promise<void>;
  refresh(id: number, userId: number, values: Pick<NewDevice, 'platform' | 'name' | 'appVersion'>): Promise<void>;
  findPublic(id: number, userId: number): Promise<PublicDevice | null>;
  revoke(id: number, userId: number): Promise<void>;
  unregisterPush(id: number, userId: number): Promise<void>;
  transaction<T>(work: (transaction: AndroidDeviceRepository) => Promise<T>): Promise<T>;
}
export class DeviceValidationError extends Error { constructor(message: string) { super(message); this.name = 'DeviceValidationError'; } }

function validated(input: DeviceRegistrationInput) {
  const deviceId = (input.deviceId ?? '').trim().toLowerCase();
  const platform = (input.platform ?? '').trim().toLowerCase();
  const name = (input.name ?? '').trim();
  const appVersion = (input.appVersion ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) throw new DeviceValidationError('device_id必须是有效UUID');
  if (platform !== 'android') throw new DeviceValidationError('platform当前只支持android');
  if (name.length < 1 || [...name].length > 80) throw new DeviceValidationError('设备名称长度必须为1到80字');
  if ([...appVersion].length > 40) throw new DeviceValidationError('App版本号不能超过40字');
  return { deviceId, platform, name, appVersion };
}

export class AndroidDeviceService {
  constructor(private readonly repository: AndroidDeviceRepository, private readonly crypto: DeviceTokenCrypto) {}
  list(userId: number) { return this.repository.listActive(userId); }
  async register(userId: number, input: DeviceRegistrationInput) {
    const value = validated(input);
    return this.repository.transaction(async (tx) => {
      const existing = await tx.findForUpdate(userId, value.deviceId);
      let id: number;
      let token: string;
      if (existing !== null && existing.revokedAt === null) {
        token = this.crypto.decryptToken(existing.tokenCiphertext);
        if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('device token cannot be recovered');
        id = existing.id;
        await tx.refresh(id, userId, { platform: value.platform, name: value.name, appVersion: value.appVersion });
      } else {
        token = this.crypto.randomToken();
        const secret = { ...value, tokenHash: this.crypto.hashToken(token), tokenCiphertext: this.crypto.encryptToken(token), tokenPrefix: token.slice(0, 8) };
        if (existing === null) id = await tx.create({ userId, ...secret });
        else { id = existing.id; await tx.restore(id, userId, secret); }
      }
      const device = await tx.findPublic(id, userId);
      if (device === null) throw new Error('device not found after registration');
      return { token, device };
    });
  }
  revoke(userId: number, id: number) { return this.repository.revoke(id, userId); }
  unregisterPush(userId: number, id: number) { return this.repository.unregisterPush(id, userId); }
}
