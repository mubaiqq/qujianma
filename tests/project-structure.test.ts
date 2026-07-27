import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Record<string, unknown>;
}

describe('project structure contract', () => {
  it('uses strict TypeScript and required lifecycle scripts', () => {
    const pkg = json('package.json') as { scripts: Record<string, string> };
    const tsconfig = json('tsconfig.json') as { compilerOptions: { strict: boolean; noUncheckedIndexedAccess: boolean } };

    expect(pkg.scripts).toMatchObject({
      build: 'tsc -p tsconfig.build.json && node scripts/copy-runtime-assets.js',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
      lint: 'eslint .',
      start: 'node dist/server.js',
      worker: 'node dist/worker.js',
    });
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  });

  it('pins Node 22 and keeps runtime secrets out of git', () => {
    const pkg = json('package.json') as { engines: { node: string } };
    const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
    const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');

    expect(pkg.engines.node).toMatch(/^>=22/);
    expect(gitignore).toContain('.env');
    expect(envExample).toContain('PORT=32200');
    expect(envExample).not.toMatch(/APP_KEY_HEX=[0-9a-f]{64}/i);
  });
});
