import base from './jest.config.js';

// For frontend hooks using Vite's import.meta. Run Node with
// --experimental-vm-modules and NODE_OPTIONS=--max-old-space-size=8192.
export default {
  ...base,
  testMatch: ['<rootDir>/client/**/*.esm.test.ts', '<rootDir>/client/**/*.esm.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: { module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', esModuleInterop: true },
    }],
  },
};
