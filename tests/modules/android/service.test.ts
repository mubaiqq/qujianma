/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from 'vitest';
import { AndroidDeviceService, DeviceValidationError, type AndroidDeviceRepository } from '../../../src/modules/android/service.js';

const uuid = '550e8400-e29b-41d4-a716-446655440000';
const active = { id: 3, userId: 7, deviceId: uuid, platform: 'android', name: 'Phone', appVersion: '1', tokenCiphertext: 'cipher', tokenPrefix: 'oldpre', revokedAt: null };
function repository(overrides: Partial<AndroidDeviceRepository> = {}): AndroidDeviceRepository {
  return { listActive: vi.fn().mockResolvedValue([]), findForUpdate: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(3), restore: vi.fn(), refresh: vi.fn(), findPublic: vi.fn().mockResolvedValue({ id: 3, device_id: uuid, platform: 'android', name: 'Phone', app_version: '1', token_prefix: 'prefix', last_used_at: null, last_seen_at: null, created_at: 'now', push_provider: null, push_enabled: false, push_last_success_at: null, push_last_error: '' }), revoke: vi.fn(), unregisterPush: vi.fn(), transaction: vi.fn(async (work) => work(repository(overrides))), ...overrides };
}
const crypto = { randomToken: vi.fn(() => 'a'.repeat(64)), hashToken: vi.fn(() => 'hash'), encryptToken: vi.fn(() => 'cipher-new'), decryptToken: vi.fn(() => 'b'.repeat(64)) };

describe('AndroidDeviceService', () => {
  it('recovers the same encrypted token for an active UUID and refreshes metadata', async () => {
    const tx = repository({ findForUpdate: vi.fn().mockResolvedValue(active) });
    const repo = repository({ transaction: vi.fn(async (work) => work(tx)) });
    const result = await new AndroidDeviceService(repo, crypto).register(7, { deviceId: uuid, platform: 'android', name: ' New ', appVersion: '2' });
    expect(result.token).toBe('b'.repeat(64));
    expect(tx.refresh).toHaveBeenCalledWith(3, 7, { platform: 'android', name: 'New', appVersion: '2' });
    expect(crypto.randomToken).not.toHaveBeenCalled();
  });

  it('rotates token and restores a revoked UUID without exposing secrets in device metadata', async () => {
    const tx = repository({ findForUpdate: vi.fn().mockResolvedValue({ ...active, revokedAt: '2026-01-01 00:00:00' }) });
    const repo = repository({ transaction: vi.fn(async (work) => work(tx)) });
    const result = await new AndroidDeviceService(repo, crypto).register(7, { deviceId: uuid, platform: 'android', name: 'Phone', appVersion: '' });
    expect(result.token).toBe('a'.repeat(64));
    expect(tx.restore).toHaveBeenCalledWith(3, 7, expect.objectContaining({ tokenHash: 'hash', tokenCiphertext: 'cipher-new', tokenPrefix: 'aaaaaaaa' }));
    expect(JSON.stringify(result.device)).not.toContain('cipher');
  });

  it.each([
    [{ deviceId: 'bad', platform: 'android', name: 'Phone', appVersion: '' }, 'device_id必须是有效UUID'],
    [{ deviceId: uuid, platform: 'ios', name: 'Phone', appVersion: '' }, 'platform当前只支持android'],
    [{ deviceId: uuid, platform: 'android', name: '', appVersion: '' }, '设备名称长度必须为1到80字'],
  ])('validates registration input', async (input, message) => {
    await expect(new AndroidDeviceService(repository(), crypto).register(7, input)).rejects.toEqual(new DeviceValidationError(message));
  });
});
