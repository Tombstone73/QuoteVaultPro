if (process.env.V2_VALIDATION_MODE !== 'db' && process.env.V2_VALIDATION_MODE !== 'qa') {
  throw new Error('V2 deterministic validation forbids dotenv imports. Classify the runtime dependency instead.');
}
// Guarded suites already received their one approved URL. Never read .env files.
module.exports = { config() { throw new Error('Explicit dotenv loading is forbidden in the V2 test harness.'); } };
