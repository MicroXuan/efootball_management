import { EnvironmentSchema } from './env.schema.js';

export function configuration() {
  const environment = EnvironmentSchema.parse(process.env);

  return {
    app: {
      environment: environment.NODE_ENV,
      port: environment.PORT
    }
  };
}
