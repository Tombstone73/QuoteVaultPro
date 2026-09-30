const path = require('node:path');
const { createRequire } = require('node:module');
const resolve = createRequire(path.join(__dirname, '../package.json')).resolve;

module.exports = {
  rootDir: path.resolve(__dirname, '..'),
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  // Membership is supplied explicitly by the classified runner, not discovery.
  testRegex: '/v2/(tests|ui/src)/.*\\.(test|spec|pure)\\.[cm]?[jt]sx?$',
  setupFiles: [],
  setupFilesAfterEnv: [],
  globalSetup: undefined,
  globalTeardown: undefined,
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^dotenv(?:/config)?$': '<rootDir>/v2/scripts/deny-dotenv.cjs',
  },
  transform: {
    '^.+\\.[tj]sx?$': [resolve('ts-jest'), {
      useESM: true,
      diagnostics: false,
      tsconfig: { module: 'ESNext', target: 'ES2022', moduleResolution: 'bundler', isolatedModules: true, esModuleInterop: true, allowSyntheticDefaultImports: true, jsx: 'react-jsx', types: ['jest', 'node'] },
    }],
  },
  cacheDirectory: '<rootDir>/.cache/v2-validation/jest',
  testTimeout: 30000,
  verbose: false,
};
