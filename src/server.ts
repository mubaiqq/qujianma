import 'dotenv/config';
import { buildApp, type SecondBatchModules } from './app.js';
import { loadConfig } from './platform/config.js';
import { createDatabase } from './platform/database.js';
import { createAuthContext } from './platform/auth-context.js';
import { decryptLegacySecret, encryptLegacySecret, tokenHash } from './platform/legacy-crypto.js';
import { createAccountCrypto } from './modules/account/crypto.js';
import { AccountService } from './modules/account/service.js';
import { MysqlAccountRepository } from './modules/account/repository.js';
import { MysqlSessionRepository } from './modules/session/repository.js';
import { MysqlParcelsRepository } from './modules/parcels/repository.js';
import { MysqlStationsRepository } from './modules/stations/repository.js';
import { StationsService } from './modules/stations/domain.js';
import { MysqlApiTokenRepository } from './modules/tokens/repository.js';
import { ApiTokenService, randomApiToken } from './modules/tokens/service.js';
import { MysqlAndroidDeviceRepository, createDeviceTokenCrypto } from './modules/android/repository.js';
import { AndroidDeviceService } from './modules/android/service.js';
import { MysqlIngestRepository } from './modules/ingest/repository.js';
import { IngestService } from './modules/ingest/service.js';
import { MysqlAiProviderRepository } from './modules/ai/repository.js';
import { AiProviderService, validateAiBaseUrl } from './modules/ai/domain.js';
import { OpenAiCompatibleClient } from './modules/ai/client.js';
import { MysqlRecognitionRepository } from './modules/recognition/repository.js';
import { RecognitionService, type UploadedImage } from './modules/recognition/service.js';
import { imageRecognitionPayload, textRecognitionPayload } from './modules/recognition/payload.js';
import { ImageRecognitionQueueService } from './modules/recognition/queue.js';
import { MysqlImageQueueRepository } from './modules/recognition/queue-repository.js';
import { MysqlSharingRepository, createShareTokenCrypto } from './modules/sharing/repository.js';
import { SharingService } from './modules/sharing/service.js';
import { MysqlNotificationRepository } from './modules/notifications/repository.js';
import { NotificationService } from './modules/notifications/service.js';
import { createPushSender } from './modules/notifications/push-sender.js';
import { MysqlAdminRepository } from './modules/admin/repository.js';

const config = loadConfig(process.env);
process.env.TZ = config.TZ;
const appKey = config.APP_KEY_HEX;
if (!appKey) throw new Error('完整 Node API 需要配置 APP_KEY_HEX');
const database = createDatabase(config);
const pool = database.write;
// Repository ports intentionally expose a minimal driver-neutral SQL contract.
const repositoryPool = pool as never;
const sessionRepository = new MysqlSessionRepository(repositoryPool);
const accountRepository = new MysqlAccountRepository(repositoryPool);
const auth = createAuthContext({ repository: sessionRepository, cookieName: config.COOKIE_NAME });
const aiClient = new OpenAiCompatibleClient(undefined, config.AI_ALLOW_PRIVATE_URLS);
const recognitionRepository = new MysqlRecognitionRepository(repositoryPool);
const recognitionService = new RecognitionService(recognitionRepository, {
  decrypt: (value) => decryptLegacySecret(value, appKey),
  textAi: async (base, key, model, prompt) => aiClient.content(await aiClient.chat(base, key, textRecognitionPayload(model, prompt), 45_000)),
  imageAi: async (base, key, model, prompt, images: UploadedImage[]) => aiClient.content(await aiClient.chat(base, key, imageRecognitionPayload(model, prompt, images), 60_000)),
});
const recognitionQueueService = new ImageRecognitionQueueService(new MysqlImageQueueRepository(repositoryPool), { uploadRoot: config.RECOGNITION_UPLOAD_ROOT ?? '/var/lib/qujianma-node/recognition-uploads' });
const aiRepository = new MysqlAiProviderRepository(repositoryPool);
const secondBatch: SecondBatchModules = {
  auth,
  tokenService: new ApiTokenService(new MysqlApiTokenRepository(repositoryPool), { generate: randomApiToken, hash: tokenHash, encrypt: (value) => encryptLegacySecret(value, appKey), decrypt: (value) => decryptLegacySecret(value, appKey), baseUrl: config.APP_BASE_URL }),
  androidService: new AndroidDeviceService(new MysqlAndroidDeviceRepository(repositoryPool), createDeviceTokenCrypto(appKey)),
  ingestService: new IngestService(new MysqlIngestRepository(repositoryPool), { process: (messageId, userId) => recognitionService.process(messageId, userId) as Promise<{ status: 'created' | 'not_pickup' | 'failed' | 'no_config'; codes?: string[] }> }, { hashToken: tokenHash }),
  aiService: new AiProviderService(aiRepository, { encrypt: (value) => encryptLegacySecret(value, appKey), decrypt: (value) => decryptLegacySecret(value, appKey), validateUrl: (url) => validateAiBaseUrl(url, { allowPrivate: config.AI_ALLOW_PRIVATE_URLS ?? false }), client: aiClient }),
  recognitionService,
  recognitionQueueService,
  sharingService: new SharingService(new MysqlSharingRepository(repositoryPool), createShareTokenCrypto(appKey), { baseUrl: config.APP_BASE_URL }),
  notificationService: new NotificationService(new MysqlNotificationRepository(repositoryPool), createPushSender({ subject: config.VAPID_SUBJECT ?? 'mailto:admin@example.com', publicKey: config.VAPID_PUBLIC_KEY ?? '', privateKey: config.VAPID_PRIVATE_KEY ?? '' }), config.VAPID_PUBLIC_KEY ?? ''),
  adminRepository: new MysqlAdminRepository(repositoryPool),
};
const app = buildApp({
  config,
  databaseReadiness: database.readiness,
  core: {
    auth,
    sessionRepository,
    accountService: new AccountService({ repository: accountRepository, ...createAccountCrypto(appKey) }),
    parcelsRepository: new MysqlParcelsRepository(repositoryPool),
    stationsService: new StationsService(new MysqlStationsRepository(repositoryPool)),
  },
  modules: secondBatch,
});

app.addHook('onClose', async () => database.close());
try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'API startup failed');
  process.exitCode = 1;
}
