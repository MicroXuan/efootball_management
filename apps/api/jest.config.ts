import type { Config } from 'jest';

const testMatch = process.env.JEST_SCOPE === 'unit'
  ? ['<rootDir>/src/**/*.spec.ts']
  : process.env.JEST_SCOPE === 'e2e'
    ? ['<rootDir>/test/**/*.e2e-spec.ts']
    : ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.e2e-spec.ts'];

const config: Config = {
  extensionsToTreatAsEsm: ['.ts'],
  maxWorkers: 1,
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testEnvironment: 'node',
  testMatch,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', useESM: true }]
  }
};

export default config;
