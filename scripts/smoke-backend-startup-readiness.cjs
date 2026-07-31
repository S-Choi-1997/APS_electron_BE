const assert = require('assert');
const {
  parsePositiveInteger,
  waitForPostgres,
} = require('../backend/startup-readiness');

async function main() {
  assert.strictEqual(parsePositiveInteger('4', 10), 4);
  assert.strictEqual(parsePositiveInteger('0', 10), 10);
  assert.strictEqual(parsePositiveInteger('invalid', 10), 10);

  const delays = [];
  let attempts = 0;
  const recovered = await waitForPostgres({
    testConnection: async () => {
      attempts += 1;
      return attempts >= 3;
    },
    maxAttempts: 5,
    retryDelayMs: 100,
    maxRetryDelayMs: 500,
    sleep: async (delayMs) => delays.push(delayMs),
    logger: { warn: () => {} },
  });

  assert.deepStrictEqual(recovered, { attempts: 3 });
  assert.deepStrictEqual(delays, [100, 200]);

  await assert.rejects(
    waitForPostgres({
      testConnection: async () => false,
      maxAttempts: 3,
      retryDelayMs: 10,
      sleep: async () => {},
      logger: { warn: () => {} },
    }),
    /PostgreSQL was not ready after 3 attempts/
  );

  console.log('BACKEND_STARTUP_READINESS_SMOKE_OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
