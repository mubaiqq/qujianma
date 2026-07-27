import { describe, expect, it } from 'vitest';
import {
  StationConflictError,
  StationsService,
  type StationRecord,
  type StationsRepository,
} from '../../../src/modules/stations/domain.js';

const row: StationRecord = {
  id: 1, name: '东门驿站', address: '东门 1 号', courier_names: '顺丰,中通', is_manual: 1,
  use_count: 0, last_used_at: null, created_at: '2026-07-25 12:00:00', parcel_count: 2, pending_count: 1,
};

class MemoryRepository implements StationsRepository {
  stations = [row];
  saved: unknown;
  deleted: unknown;
  marked: unknown;
  conflict = false;

  list(userId: number) { return Promise.resolve(userId === 7 ? this.stations : []); }
  save(userId: number, input: Parameters<StationsRepository['save']>[1]): Promise<void> {
    void userId;
    if (this.conflict) return Promise.reject(new StationConflictError());
    this.saved = input;
    return Promise.resolve();
  }
  delete(userId: number, stationId: number) { this.deleted = { userId, stationId }; return Promise.resolve(); }
  markAllPicked(userId: number, stationId: number) {
    this.marked = { userId, stationId };
    return Promise.resolve({ station: '东门驿站', count: 3 });
  }
}

const failure = (status: number, message: string) => ({ status, body: { code: 1 as const, message } });

describe('StationsService legacy semantics', () => {
  it('lists repository rows without renaming legacy fields', async () => {
    const repository = new MemoryRepository();
    await expect(new StationsService(repository).list(7)).resolves.toEqual({ status: 200, body: { code: 0, data: [row] } });
  });

  it('validates required PHP-trimmed station name and address', async () => {
    const service = new StationsService(new MemoryRepository());
    await expect(service.save(7, { name: ' \t\n\r\v\0', address: '地址' })).resolves.toEqual(failure(422, '请填写驿站名称和地址'));
    await expect(service.save(7, { name: '驿站', address: '\0\v\r\n\t ' })).resolves.toEqual(failure(422, '请填写驿站名称和地址'));
  });

  it('matches PHP default trim without stripping full-width spaces or NBSP', async () => {
    const repository = new MemoryRepository();
    await new StationsService(repository).save(7, {
      name: ' \t　驿站\u00a0\r\n',
      address: '\0\v\u00a0地址　 ',
      courier_names: ' \n　顺丰， 中通\u00a0\0',
    });
    expect(repository.saved).toMatchObject({
      name: '　驿站\u00a0',
      address: '\u00a0地址　',
      courierNames: '　顺丰,中通\u00a0',
    });
  });

  it('truncates by Unicode code points, normalizes courier commas, and removes whitespace for normalized_name', async () => {
    const repository = new MemoryRepository();
    const service = new StationsService(repository);
    await service.save(7, {
      id: 0,
      name: `  东\u3000门 ${'😀'.repeat(120)}尾  `,
      address: `  地址${'界'.repeat(260)}  `,
      courier_names: ` 顺丰 ， 中通、、 圆通, 韵达 ${'长'.repeat(260)}`,
    });
    expect(repository.saved).toEqual({
      id: 0,
      name: `东\u3000门 ${'😀'.repeat(116)}`,
      normalizedName: `东门${'😀'.repeat(116)}`,
      address: `地址${'界'.repeat(253)}`,
      courierNames: `顺丰,中通,圆通,韵达 ${'长'.repeat(243)}`,
    });
  });

  it('uses Unicode lowercase for normalized_name', async () => {
    const repository = new MemoryRepository();
    await new StationsService(repository).save(7, { name: ' Ä BC\u3000驿站 ', address: '地址' });
    expect(repository.saved).toMatchObject({ normalizedName: 'äbc驿站' });
  });

  it('maps duplicate names to the legacy 409 response', async () => {
    const repository = new MemoryRepository();
    repository.conflict = true;
    await expect(new StationsService(repository).save(7, { name: '东门', address: '地址' }))
      .resolves.toEqual(failure(409, '已存在同名驿站'));
  });

  it('returns refreshed rows after save and delete', async () => {
    const repository = new MemoryRepository();
    const service = new StationsService(repository);
    await expect(service.save(7, { name: '东门', address: '地址' })).resolves.toEqual({
      status: 200, body: { code: 0, message: '保存成功', data: [row] },
    });
    await expect(service.delete(7, 1)).resolves.toEqual({
      status: 200, body: { code: 0, message: '驿站已删除', data: [row] },
    });
  });

  it('validates station ids before delete and bulk pickup', async () => {
    const service = new StationsService(new MemoryRepository());
    await expect(service.delete(7, 0)).resolves.toEqual(failure(422, '驿站参数错误'));
    await expect(service.markAllPicked(7, -1)).resolves.toEqual(failure(422, '驿站参数错误'));
  });

  it('returns station name and changed count for bulk pickup', async () => {
    await expect(new StationsService(new MemoryRepository()).markAllPicked(7, 1)).resolves.toEqual({
      status: 200, body: { code: 0, message: '已全部取出', data: { station: '东门驿站', count: 3 } },
    });
  });

  it('preserves the legacy bulk-pickup 404 response for other transaction errors', async () => {
    const repository = new MemoryRepository();
    repository.markAllPicked = () => Promise.reject(new Error('数据库写入失败'));
    await expect(new StationsService(repository).markAllPicked(7, 1)).resolves.toEqual(failure(404, '数据库写入失败'));
  });
});
