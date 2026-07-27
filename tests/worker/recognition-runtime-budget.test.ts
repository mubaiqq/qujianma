import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('recognition provider runtime budget', () => {
  it('allows the measured provider tail beyond 60 seconds while staying below the worker lease', async () => {
    const source = await readFile(new URL('../../src/recognition-worker.ts', import.meta.url), 'utf8');
    expect(source).toContain('75_000');
    expect(source).toContain('maxAttempts:1');
    expect(source).not.toContain('images),60_000');
    expect(source).not.toContain('90_000');
  });
});
