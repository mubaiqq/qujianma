import type { FastifyInstance } from 'fastify';

export const legacyVersion = '2026.07.26.1';
export const legacyAssetVersion = '20260725-android-release-page-1';

export function registerVersionRoutes(app: FastifyInstance): void {
  app.get('/api/version', (_request, reply) => reply
    .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    .header('Pragma', 'no-cache')
    .send({ code: 0, version: legacyVersion, asset_version: legacyAssetVersion }));
}
