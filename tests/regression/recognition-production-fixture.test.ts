import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface Manifest {
  fixture_version: number;
  cases: Array<{ source_message_id: number; file: string; expected: string }>;
  assets: Array<{ file: string; mime_type: string; width: number; height: number; size_bytes: number; sha256: string }>;
  unavailable_success_assets: Array<{ source_job_id: number; reason: string; recoverable: boolean }>;
}

const fixtureRoot = resolve(process.cwd(), 'tests/fixtures/recognition-production-20260726');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(resolve(fixtureRoot, file), 'utf8')) as T;

describe('sanitized production recognition fixture', () => {
  it('loads all four cases without forbidden identity or credential fields', () => {
    const manifest = readJson<Manifest>('manifest.json');
    expect(manifest.fixture_version).toBe(1);
    expect(manifest.cases.map(({ source_message_id }) => source_message_id)).toEqual([260, 261, 262, 263]);

    for (const item of manifest.cases) {
      const fixture = readJson<Record<string, unknown>>(item.file);
      const serialized = JSON.stringify(fixture);
      expect(serialized).not.toMatch(/"(?:user_?id|client_?ip|phone|mobile|token|api_?key|password|secret|authorization)"\s*:/i);
      expect(serialized).not.toMatch(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/);
      expect(fixture).toMatchObject({ source_message_id: item.source_message_id, expected: item.expected });
    }
  });

  it('verifies the preserved failed PNG and records successful images as unrecoverable', () => {
    const manifest = readJson<Manifest>('manifest.json');
    const asset = manifest.assets[0];
    expect(asset).toBeDefined();
    if (!asset) throw new Error('fixture image is missing from manifest');
    const bytes = readFileSync(resolve(fixtureRoot, asset.file));
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(asset).toMatchObject({ mime_type: 'image/png', width: 736, height: 1600, size_bytes: bytes.length });
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    expect(manifest.unavailable_success_assets).toEqual([
      { source_job_id: 17, reason: 'deleted_after_success_by_design', recoverable: false },
      { source_job_id: 18, reason: 'deleted_after_success_by_design', recoverable: false },
      { source_job_id: 20, reason: 'deleted_after_success_by_design', recoverable: false },
    ]);
  });
});
