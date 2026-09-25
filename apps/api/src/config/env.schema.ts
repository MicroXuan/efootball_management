import { z } from 'zod';

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_URL: z.string().startsWith('mysql://'),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  WECHAT_APP_ID: z.string().min(1),
  WECHAT_APP_SECRET: z.string().min(1),
  WECHAT_GATEWAY_MODE: z.enum(['fake', 'http']).default('fake'),
  PESDATA_BASE_URL: z.url().default('https://pesdata.net'),
  PESDATA_SITE_VERSION: z.string().min(1).default('1.9.0'),
  PESDATA_SIGNATURE_SEED: z.string().min(1).optional(),
  PESDATA_REQUESTS_PER_SECOND: z.coerce.number().positive().max(5).default(1),
  PESDATA_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  PESDATA_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(5)
}).passthrough();

export type Environment = z.infer<typeof EnvironmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  return EnvironmentSchema.parse(input);
}
