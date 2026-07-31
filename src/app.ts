import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { AppConfig } from './platform/config.js';
import { errorHandler } from './platform/errors.js';
import { registerVersionRoutes } from './modules/version/routes.js';
import type { DatabaseReadiness } from './platform/database.js';
import type { AuthContext, AuthenticatedContext } from './platform/auth-context.js';
import type { AccountService } from './modules/account/service.js';
import type { MysqlParcelsRepository } from './modules/parcels/repository.js';
import type { StationsService } from './modules/stations/domain.js';
import type { SessionRepository } from './modules/session/domain.js';
import type { ApiTokenService } from './modules/tokens/service.js';
import type { AndroidDeviceService } from './modules/android/service.js';
import type { IngestService } from './modules/ingest/service.js';
import type { AiProviderService } from './modules/ai/domain.js';
import type { RecognitionService, UploadedImage } from './modules/recognition/service.js';
import type { ImageRecognitionQueueService } from './modules/recognition/queue.js';
import type { SharingService } from './modules/sharing/service.js';
import type { NotificationService } from './modules/notifications/service.js';
import type { AdminRepository } from './modules/admin/repository.js';
import type { PublicPageViews } from './modules/pages/routes.js';
import { adminViews } from './modules/admin/views.js';
import { registerAccountRoutes } from './modules/account/routes.js';
import { registerSessionRoutes } from './modules/session/routes.js';
import { registerParcelsRoutes } from './modules/parcels/routes.js';
import { registerStationsRoutes } from './modules/stations/routes.js';
import { registerTokenRoutes } from './modules/tokens/routes.js';
import { registerAndroidDeviceRoutes } from './modules/android/routes.js';
import { registerIngestRoutes } from './modules/ingest/routes.js';
import { registerAiRoutes } from './modules/ai/routes.js';
import { registerOfficialAiRoutes } from './modules/ai/official-routes.js';
import type { OfficialAiService } from './modules/ai/official.js';
import { officialAiAdminView } from './modules/admin/official-ai-view.js';
import { registerRecognitionRoutes } from './modules/recognition/routes.js';
import { registerSharingRoutes } from './modules/sharing/routes.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import { registerPageRoutes } from './modules/pages/routes.js';

export interface CoreModules {
  auth: AuthContext;
  sessionRepository: SessionRepository;
  accountService: AccountService;
  parcelsRepository: MysqlParcelsRepository;
  stationsService: StationsService;
}

export interface SecondBatchModules {
  auth: AuthContext;
  tokenService: Pick<ApiTokenService, 'get' | 'regenerate'>;
  androidService: Pick<AndroidDeviceService, 'list' | 'register' | 'revoke' | 'unregisterPush'>;
  ingestService: Pick<IngestService, 'ingest' | 'ingestManual'>;
  aiService: Pick<AiProviderService, 'status' | 'list' | 'save' | 'select' | 'delete' | 'fetchModels' | 'test'>;
  officialAiService: OfficialAiService;
  recognitionService: Pick<RecognitionService, 'retry' | 'recognizeImages'>;
  recognitionQueueService?: ImageRecognitionQueueService;
  sharingService: Pick<SharingService, 'status' | 'createOrReuse' | 'regenerate' | 'cancel' | 'getPublic' | 'markPublicPicked'>;
  notificationService: Pick<NotificationService, 'get' | 'subscribe' | 'unsubscribe' | 'savePreferences' | 'testPush' | 'broadcast'>;
  adminRepository: AdminRepository;
  pageViews?: PublicPageViews;
}

export interface BuildAppOptions {
  config: AppConfig;
  databaseReadiness?: () => Promise<DatabaseReadiness>;
  core?: CoreModules;
  modules?: SecondBatchModules;
}

async function parseImages(request: FastifyRequest): Promise<UploadedImage[]> {
  const images: UploadedImage[] = [];
  for await (const part of request.files({ limits: { files: 5, fileSize: 6 * 1024 * 1024 } })) {
    images.push({ bytes: await part.toBuffer(), mime: part.mimetype });
  }
  return images;
}

export function buildApp({ config, databaseReadiness, core, modules }: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL } });
  const projectRoot = basename(import.meta.dirname) === 'dist' ? import.meta.dirname : resolve(import.meta.dirname, '..');

  void app.register(fastifyStatic, { root: resolve(projectRoot, 'public'), serve: false, decorateReply: true });
  void app.register(fastifyCookie);
  void app.register(fastifyMultipart, { limits: { files: 5, fileSize: 6 * 1024 * 1024 } });

  app.setErrorHandler(errorHandler);
  registerVersionRoutes(app);
  app.after(() => {
    if (core) {
      const cookieSecure = new URL(config.APP_BASE_URL).protocol === 'https:';
      registerSessionRoutes(app, { repository: core.sessionRepository, cookieName: config.COOKIE_NAME, cookieRegistered: true, cookieSecure });
      registerAccountRoutes(app, { service: core.accountService, auth: core.auth, cookieName: config.COOKIE_NAME, cookieSecure });
      registerParcelsRoutes(app, { repository: core.parcelsRepository, auth: core.auth });
      registerStationsRoutes(app, { service: core.stationsService, auth: core.auth });
    }
    if (modules) {
      const contexts = new WeakMap<FastifyRequest, AuthenticatedContext>();
      app.addHook('preHandler', async (request, reply) => {
        const context = await modules.auth.authenticate(request, reply);
        if (context) contexts.set(request, context);
      });
      const resolveSession = (request: FastifyRequest) => Promise.resolve(contexts.get(request)?.user ?? null);
      const resolveUserId = (request: FastifyRequest) => Promise.resolve(contexts.get(request)?.user.id ?? null);
      const verifyCsrf = (request: FastifyRequest) => {
        const context = contexts.get(request);
        const supplied = request.headers['x-csrf-token'];
        return context !== undefined && typeof supplied === 'string' && supplied === modules.auth.csrf(context.token);
      };
      registerTokenRoutes(app, { auth: modules.auth, service: modules.tokenService });
      registerAndroidDeviceRoutes(app, { service: modules.androidService, resolveSession, cookieName: config.COOKIE_NAME, cookieRegistered: true });
      registerIngestRoutes(app, { service: modules.ingestService, resolveUserId, verifyCsrf: (request) => Promise.resolve(verifyCsrf(request)) });
      registerAiRoutes(app, { service: modules.aiService, resolveUserId, verifyCsrf: (request) => Promise.resolve(verifyCsrf(request)) });
      registerOfficialAiRoutes(app,{auth:modules.auth,service:modules.officialAiService,adminView:officialAiAdminView});
      registerRecognitionRoutes(app, { service: modules.recognitionService as RecognitionService, ...(modules.recognitionQueueService ? { queue: modules.recognitionQueueService } : {}), resolveUserId, verifyCsrf: (request) => Promise.resolve(verifyCsrf(request)), parseImages });
      registerSharingRoutes(app, { service: modules.sharingService, resolveSession, verifyCsrf });
      registerNotificationRoutes(app, { service: modules.notificationService, resolveSession, verifyCsrf });
      registerAdminRoutes(app, { auth: modules.auth, repository: modules.adminRepository, views: adminViews, broadcaster: modules.notificationService });
      registerPageRoutes(app, { auth: modules.auth, articles: modules.adminRepository, ...(modules.pageViews ? { views: modules.pageViews } : { viewsRoot: resolve(projectRoot, 'views/public') }) });
    } else {
      app.get('/guide', (_request, reply) => reply.redirect('/login'));
    }
  });

  app.get('/android', (_request, reply) => reply.type('text/html; charset=utf-8').send(readFileSync(resolve(projectRoot, 'views/android.html'), 'utf8')));
  app.get('/manifest.webmanifest', (_request, reply) => reply.sendFile('manifest.webmanifest'));
  app.get('/service-worker.js', (_request, reply) => reply.header('Cache-Control', 'no-cache, no-store, must-revalidate').sendFile('service-worker.js', { cacheControl: false }));
  app.get('/favicon.ico', (_request, reply) => reply.sendFile('favicon.ico'));
  app.get('/assets/*', (request, reply) => {
    const wildcard = (request.params as { '*': string })['*'];
    let assetPath: string;
    try { assetPath = decodeURIComponent(wildcard); } catch { return reply.status(400).send({ code: 1, message: '资源路径无效' }); }
    if (assetPath.includes('\0') || assetPath.includes('\\') || assetPath.split('/').some((segment) => segment === '.' || segment === '..') || basename(assetPath) === '') return reply.status(400).send({ code: 1, message: '资源路径无效' });
    const version = (request.query as { v?: unknown }).v;
    return reply.sendFile(`assets/${assetPath}`, typeof version === 'string' && version.length > 0 ? { immutable: true, maxAge: '365d' } : { immutable: false, maxAge: 0 });
  });

  app.get('/health/live', () => ({ status: 'ok', service: 'qujianma-node-api', version: config.APP_VERSION, timestamp: new Date().toISOString() }));
  app.get('/health/ready', async (_request, reply) => {
    if (!databaseReadiness) return { status: 'degraded', service: 'qujianma-node-api', version: config.APP_VERSION, database: 'pending_connection_migration', worker: 'pending_migration' };
    try {
      const status = await databaseReadiness();
      if (status.missingTables.length > 0 || status.writePrivileges.length > 0) throw new Error('database readiness contract failed');
      return { status: 'degraded', service: 'qujianma-node-api', version: config.APP_VERSION, database: 'ready_read_only', worker: 'pending_migration' };
    } catch (error) {
      app.log.error({ err: error }, 'database readiness failed');
      return reply.status(503).send({ status: 'unavailable', service: 'qujianma-node-api', version: config.APP_VERSION, database: 'unavailable', worker: 'pending_migration' });
    }
  });
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ code: 1, message: '接口不存在' }));
  return app;
}
