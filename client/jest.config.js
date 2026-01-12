import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('ts-jest').JestConfigWithTsJest} */
const rootDir = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  // Jest's testMatch globs use micromatch; on Windows, backslashes can escape
  // the extglob segment in '?(*.)'. Force POSIX separators.
  .replace(/\\/g, '/');

export default {
  // Run from repo root so testMatch can target client/** exactly
  rootDir,

  // Client-only tests: avoid server/DB setup and use a browser-like env
  testEnvironment: 'jsdom',

  // TS/TSX support
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // Compile tests to CJS to avoid requiring NODE_OPTIONS=--experimental-vm-modules
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'bundler',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          jsx: 'react-jsx',
        },
      },
    ],
  },

  testMatch: [
    '<rootDir>/client/**/?(*.)+(spec|test).[tj]s?(x)',
    // Windows path normalization can break the extglob segment above;
    // keep explicit patterns as a fallback.
    '<rootDir>/client/**/*.test.ts',
    '<rootDir>/client/**/*.test.tsx',
    '<rootDir>/client/**/*.spec.ts',
    '<rootDir>/client/**/*.spec.tsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Keep aliases consistent with app code
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/client/src/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',

    // Support TS "nodeNext" style relative imports that end in .js
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Client tests must not run server test setup
  setupFilesAfterEnv: [],

  testTimeout: 30000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
