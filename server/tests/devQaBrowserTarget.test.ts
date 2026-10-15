import { describe, expect, test } from '@jest/globals';
import { getDevQaConfig } from '../../e2e/devQaAuth';

const env = {
  PLAYWRIGHT_BASE_URL: 'https://dev.printershero.com',
  PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: 'https://dev.printershero.com',
  PRINTERSHERO_DEV_QA_EMAIL: 'qa@example.test',
  PRINTERSHERO_DEV_QA_PASSWORD: 'fixture-only',
  PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID: 'dev-org',
  PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG: 'dev-org',
};

describe('DEV browser QA target', () => {
  test('accepts the reviewed DEV origin', () => {
    expect(getDevQaConfig(env).baseUrl.origin).toBe('https://dev.printershero.com');
  });

  test.each([
    { ...env, PLAYWRIGHT_BASE_URL: 'https://printershero.com', PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: 'https://printershero.com' },
    { ...env, PLAYWRIGHT_BASE_URL: 'https://www.printershero.com', PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: 'https://www.printershero.com' },
    { ...env, PLAYWRIGHT_BASE_URL: 'https://api.printershero.com', PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: 'https://api.printershero.com' },
    { ...env, PLAYWRIGHT_BASE_URL: 'https://other-dev.example.com', PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: 'https://other-dev.example.com' },
    { ...env, PLAYWRIGHT_BASE_URL: 'http://dev.printershero.com', PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: 'http://dev.printershero.com' },
    { ...env, PLAYWRIGHT_BASE_URL: 'https://dev.printershero.com', PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: 'https://printershero.com' },
  ])('rejects any unapproved credential target', (candidate) => {
    expect(() => getDevQaConfig(candidate)).toThrow();
  });
});
