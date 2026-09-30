import { EnvironmentSchema } from './env.schema.js';
import { resolve } from 'node:path';

export function configuration() {
  const environment = EnvironmentSchema.parse(process.env);

  return {
    app: {
      environment: environment.NODE_ENV,
      port: environment.PORT
    },
    wechat: {
      gatewayMode: environment.WECHAT_GATEWAY_MODE,
      devOpenId: environment.DEV_WECHAT_OPEN_ID
    },
    pesdata: {
      baseUrl: environment.PESDATA_BASE_URL,
      siteVersion: environment.PESDATA_SITE_VERSION,
      signatureSeed: environment.PESDATA_SIGNATURE_SEED,
      requestsPerSecond: environment.PESDATA_REQUESTS_PER_SECOND,
      timeoutMs: environment.PESDATA_TIMEOUT_MS,
      maxRetries: environment.PESDATA_MAX_RETRIES
    },
    storage: {
      provider: environment.STORAGE_PROVIDER,
      localDirectory: resolve(environment.LOCAL_STORAGE_DIR),
      publicApiBaseUrl: environment.PUBLIC_API_BASE_URL,
      cloudbase: {
        environmentId: environment.CLOUDBASE_ENV_ID,
        secretId: environment.CLOUDBASE_SECRET_ID,
        secretKey: environment.CLOUDBASE_SECRET_KEY
      }
    }
  };
}
