import { z } from 'zod';

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_URL: z.string().startsWith('mysql://'),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  ADMIN_REFRESH_TOKEN_PEPPER: z.string().min(32).optional(),
  WECHAT_APP_ID: z.string().min(1),
  WECHAT_APP_SECRET: z.string().min(1),
  WECHAT_GATEWAY_MODE: z.enum(['fake', 'http']).default('fake'),
  DEV_WECHAT_OPEN_ID: z.string().trim().min(1).optional(),
  PESDATA_BASE_URL: z.url().default('https://pesdata.net'),
  PESDATA_SITE_VERSION: z.string().min(1).default('1.9.0'),
  PESDATA_SIGNATURE_SEED: z.string().min(1).optional(),
  PESDATA_REQUESTS_PER_SECOND: z.coerce.number().positive().max(5).default(1),
  PESDATA_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  PESDATA_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(5),
  STORAGE_PROVIDER: z.enum(['local', 'cloudbase']).default('local'),
  LOCAL_STORAGE_DIR: z.string().trim().min(1).default('.data/uploads'),
  PUBLIC_API_BASE_URL: z.url().default('http://127.0.0.1:3000'),
  CLOUDBASE_ENV_ID: z.string().trim().min(1).optional(),
  CLOUDBASE_SECRET_ID: z.string().trim().min(1).optional(),
  CLOUDBASE_SECRET_KEY: z.string().trim().min(1).optional(),
  WECHAT_BOT_OUTBOX_LEASE_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  WECHAT_BOT_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  WECHAT_BOT_HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
  WECHAT_BOT_COMMAND_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(24)
}).passthrough().superRefine((environment, context) => {
  if (environment.STORAGE_PROVIDER !== 'cloudbase') return;
  for (const field of ['CLOUDBASE_ENV_ID', 'CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRET_KEY'] as const) {
    if (!environment[field]) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required when STORAGE_PROVIDER=cloudbase`
      });
    }
  }
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  return EnvironmentSchema.parse(input);
}
