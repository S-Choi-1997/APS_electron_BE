const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectMailDomain, validateRecipientDomains } = require('../email-recipient-validation');

test('accepts a domain with MX records', async () => {
  const resolver = {
    resolveMx: async () => [{ exchange: 'mail.example.com', priority: 10 }],
    resolve4: async () => [],
    resolve6: async () => [],
  };
  const result = await inspectMailDomain('example.com', { resolver });
  assert.deepEqual(result, { domain: 'example.com', valid: true, verified: true, reason: 'mx' });
});

test('rejects NXDOMAIN when no address fallback exists', async () => {
  const missing = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  const resolver = {
    resolveMx: async () => { throw missing; },
    resolve4: async () => { throw missing; },
    resolve6: async () => { throw missing; },
  };
  const result = await validateRecipientDomains(['person@missing.example'], { resolver });
  assert.equal(result.valid, false);
  assert.equal(result.invalid[0].reason, 'domain_not_found');
});

test('does not block delivery on transient DNS failure', async () => {
  const transient = Object.assign(new Error('temporary failure'), { code: 'ETIMEOUT' });
  const resolver = {
    resolveMx: async () => { throw transient; },
    resolve4: async () => { throw transient; },
    resolve6: async () => { throw transient; },
  };
  const result = await validateRecipientDomains(['person@example.com'], { resolver });
  assert.equal(result.valid, true);
  assert.equal(result.unverified.length, 1);
});
