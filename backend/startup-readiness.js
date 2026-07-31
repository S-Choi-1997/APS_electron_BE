function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function waitForPostgres({
  testConnection,
  maxAttempts = 10,
  retryDelayMs = 1000,
  maxRetryDelayMs = 10000,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  logger = console,
} = {}) {
  if (typeof testConnection !== 'function') {
    throw new TypeError('testConnection must be a function');
  }

  const normalizedMaxAttempts = parsePositiveInteger(maxAttempts, 10);
  const normalizedRetryDelayMs = parsePositiveInteger(retryDelayMs, 1000);
  const normalizedMaxRetryDelayMs = Math.max(
    normalizedRetryDelayMs,
    parsePositiveInteger(maxRetryDelayMs, 10000)
  );
  let lastError = null;

  for (let attempt = 1; attempt <= normalizedMaxAttempts; attempt += 1) {
    try {
      if (await testConnection()) {
        return { attempts: attempt };
      }
      lastError = new Error('PostgreSQL connection test returned false');
    } catch (error) {
      lastError = error;
    }

    if (attempt >= normalizedMaxAttempts) break;

    const delayMs = Math.min(
      normalizedRetryDelayMs * (2 ** (attempt - 1)),
      normalizedMaxRetryDelayMs
    );
    logger.warn(
      `[DB] PostgreSQL is not ready (attempt ${attempt}/${normalizedMaxAttempts}); retrying in ${delayMs}ms`
    );
    await sleep(delayMs);
  }

  const error = new Error(
    `PostgreSQL was not ready after ${normalizedMaxAttempts} attempts: ${lastError?.message || 'unknown error'}`
  );
  error.cause = lastError;
  throw error;
}

module.exports = {
  parsePositiveInteger,
  waitForPostgres,
};
