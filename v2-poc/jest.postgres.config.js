/**
 * PostgreSQL-only V2 experiment runner. It intentionally does not import the
 * repository-wide Jest setup, whose V1 test-target policy remains unchanged.
 * `setup.ts` fails before test modules can connect unless the V2 safety guard
 * has accepted the explicit operator-approved disposable target and found no
 * other database URL exposed to the harness.
 */
export default {
  rootDir: "..",
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  testMatch: ["<rootDir>/v2-poc/tests/postgres/**/*.test.ts"],
  setupFiles: ["<rootDir>/v2-poc/tests/postgres/setup.ts"],
  transform: {
    "^.+\\.[tj]sx?$": ["ts-jest", { useESM: true, diagnostics: false, tsconfig: { module: "ESNext", moduleResolution: "bundler", esModuleInterop: true, types: ["jest", "node"] } }],
  },
};
