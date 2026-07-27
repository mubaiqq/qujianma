import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(32200),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TZ: z.string().min(1).default('Asia/Shanghai'),
  APP_VERSION: z.string().min(1).default('0.1.0'),
  APP_BASE_URL: z.string().url().default('https://pickup-next.mubaiyun.xyz'),
  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1).default('express_pickup'),
  DB_USER: z.string().min(1).default('replace_me'),
  DB_PASSWORD: z.string().default(''),
  DB_WRITE_USER: z.string().min(1).optional(),
  DB_WRITE_PASSWORD: z.string().optional(),
  COOKIE_NAME: z.string().min(1).default('pickup_login'),
  APP_KEY_HEX: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  AI_ALLOW_PRIVATE_URLS: z.enum(['true', 'false']).transform((value) => value === 'true').default('false'),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  WORKER_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true').default('false'),
  WORKER_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(300).default(15),
  RECOGNITION_WORKER_ENABLED: z.enum(['true', 'false']).transform((value) => value === 'true').default('false'),
  RECOGNITION_UPLOAD_ROOT: z.string().min(1).default('/var/lib/qujianma-node/recognition-uploads'),
});

type ParsedAppConfig = z.infer<typeof environmentSchema>;
type OptionalConfigKeys = 'AI_ALLOW_PRIVATE_URLS' | 'VAPID_SUBJECT' | 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'RECOGNITION_WORKER_ENABLED' | 'RECOGNITION_UPLOAD_ROOT';
export type AppConfig = Omit<ParsedAppConfig, OptionalConfigKeys> & Partial<Pick<ParsedAppConfig, OptionalConfigKeys>>;

export function loadConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || 'environment'))].join(', ');
    throw new Error(`应用配置无效：${fields}`);
  }
  return result.data;
}
