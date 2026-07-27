import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const distRoot = resolve(projectRoot, 'dist');

await mkdir(distRoot, { recursive: true });
for (const directory of ['public', 'views']) {
  const destination = resolve(distRoot, directory);
  await rm(destination, { recursive: true, force: true });
  await cp(resolve(projectRoot, directory), destination, { recursive: true });
}
