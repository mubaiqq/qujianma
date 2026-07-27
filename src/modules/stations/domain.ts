export interface StationRecord {
  id: number;
  name: string;
  address: string;
  courier_names: string;
  is_manual: number;
  use_count: number;
  last_used_at: Date | string | null;
  created_at: Date | string;
  parcel_count: number | string;
  pending_count: number | string;
}

export interface SaveStationRecord {
  id: number;
  name: string;
  normalizedName: string;
  address: string;
  courierNames: string;
}

export interface StationsRepository {
  list(userId: number): Promise<StationRecord[]>;
  save(userId: number, station: SaveStationRecord): Promise<void>;
  delete(userId: number, stationId: number): Promise<void>;
  markAllPicked(userId: number, stationId: number): Promise<{ station: string; count: number }>;
}

export class StationConflictError extends Error {}
export class StationNotFoundError extends Error {}
export class StationHasPendingParcelsError extends Error {}

export interface SaveStationInput {
  id?: number;
  name?: string;
  address?: string;
  courier_names?: string;
}

type StationsResult = {
  status: number;
  body: { code: 0 | 1; message?: string; data?: StationRecord[] | { station: string; count: number } };
};

const failure = (status: number, message: string): StationsResult => ({ status, body: { code: 1, message } });
const unicodeSlice = (value: string, length: number): string => Array.from(value).slice(0, length).join('');
const phpTrim = (value: string): string => value.replace(/^[ \t\n\r\v\0]+|[ \t\n\r\v\0]+$/g, '');

export class StationsService {
  constructor(private readonly repository: StationsRepository) {}

  async list(userId: number): Promise<StationsResult> {
    return { status: 200, body: { code: 0, data: await this.repository.list(userId) } };
  }

  async save(userId: number, input: SaveStationInput): Promise<StationsResult> {
    const name = unicodeSlice(phpTrim(input.name ?? ''), 120);
    const address = unicodeSlice(phpTrim(input.address ?? ''), 255);
    const courierNames = unicodeSlice(
      phpTrim(input.courier_names ?? '').replace(/\s*[,，、]+\s*/gu, ','),
      255,
    );
    if (name === '' || address === '') return failure(422, '请填写驿站名称和地址');
    const normalizedName = name.replace(/[\s\u3000]+/gu, '').toLowerCase();
    try {
      await this.repository.save(userId, { id: Math.trunc(input.id ?? 0), name, normalizedName, address, courierNames });
    } catch (error) {
      if (error instanceof StationConflictError) return failure(409, '已存在同名驿站');
      if (error instanceof StationNotFoundError) return failure(404, '驿站不存在');
      throw error;
    }
    return { status: 200, body: { code: 0, message: '保存成功', data: await this.repository.list(userId) } };
  }

  async delete(userId: number, stationId: number): Promise<StationsResult> {
    if (stationId < 1) return failure(422, '驿站参数错误');
    try {
      await this.repository.delete(userId, stationId);
    } catch (error) {
      if (error instanceof StationNotFoundError) return failure(404, '驿站不存在');
      if (error instanceof StationHasPendingParcelsError) return failure(409, '该驿站还有未取件，暂时不能删除');
      throw error;
    }
    return { status: 200, body: { code: 0, message: '驿站已删除', data: await this.repository.list(userId) } };
  }

  async markAllPicked(userId: number, stationId: number): Promise<StationsResult> {
    if (stationId < 1) return failure(422, '驿站参数错误');
    try {
      const data = await this.repository.markAllPicked(userId, stationId);
      return { status: 200, body: { code: 0, message: '已全部取出', data } };
    } catch (error) {
      if (error instanceof StationNotFoundError) return failure(404, '驿站不存在');
      return failure(404, error instanceof Error ? error.message : String(error));
    }
  }
}
